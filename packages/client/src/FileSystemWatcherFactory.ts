import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { Subject } from "rxjs"
import vscode, { RelativePattern, workspace } from "vscode"

export type WatchEvent = (
	| { type: "create", exists: true }
	| { type: "change" }
	| { type: "delete", exists: false }
)

class DisposableSubject<T> extends Subject<T> implements AsyncDisposable {

	constructor(private readonly disposeAsync: () => Promise<void>) {
		super()
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.disposeAsync()
	}
}

class FolderWatcher extends RefCountAsyncDisposableFactory<string, DisposableSubject<WatchEvent>> implements AsyncDisposable {

	private readonly stack: DisposableStack

	constructor(private readonly dirname: Uri) {
		super(
			(basename) => basename,
			async (basename, factory) => { throw new Error("unreachable") }
		)

		this.stack = new DisposableStack()

		const pattern = new RelativePattern(vscode.Uri.parse(dirname.toString()), "*")
		const watcher = this.stack.adopt(workspace.createFileSystemWatcher(pattern), (watcher) => watcher.dispose())

		const next = (uri: Uri, event: WatchEvent) => {
			const basename = dirname.relative(uri)
			return this.map.get(basename)?.value.then((subject) => subject.next(event))
		}

		this.stack.adopt(watcher.onDidChange((event) => next(new Uri(event), { type: "change" })), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidCreate((event) => next(new Uri(event), { type: "create", exists: true })), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidDelete((event) => next(new Uri(event), { type: "delete", exists: false })), (disposable) => disposable.dispose())
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.stack.dispose()
	}
}

export class FileSystemWatcherFactory extends RefCountAsyncDisposableFactory<Uri, DisposableSubject<WatchEvent>> {
	private readonly folderWatchers: RefCountAsyncDisposableFactory<Uri, FolderWatcher>

	constructor() {
		super(
			(uri) => uri.toString(),
			async (uri) => {
				const dirname = uri.dirname()
				const basename = uri.basename()
				const folderWatcher = await this.folderWatchers.get(dirname)
				const fileWatcher = await folderWatcher.get(basename, async () => new DisposableSubject<WatchEvent>(async () => await folderWatcher[Symbol.asyncDispose]()))
				return fileWatcher
			}
		)

		this.folderWatchers = new RefCountAsyncDisposableFactory(
			(dirname) => dirname.toString(),
			async (dirname) => new FolderWatcher(dirname)
		)
	}
}
