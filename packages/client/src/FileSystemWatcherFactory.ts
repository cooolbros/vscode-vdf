import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { Subject } from "rxjs"
import vscode, { RelativePattern, workspace } from "vscode"

export type EventType = "change" | "create" | "delete"

class DisposableSubject<T> extends Subject<T> implements AsyncDisposable {

	constructor(private readonly disposeAsync: () => Promise<void>) {
		super()
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.disposeAsync()
	}
}

class FolderWatcher extends RefCountAsyncDisposableFactory<string, DisposableSubject<EventType>> implements AsyncDisposable {

	private readonly stack: DisposableStack

	constructor(private readonly dirname: Uri) {
		super(
			(basename) => basename,
			async (basename, factory) => { throw new Error("unreachable") }
		)

		this.stack = new DisposableStack()

		const pattern = new RelativePattern(vscode.Uri.parse(dirname.toString()), "*")
		const watcher = this.stack.adopt(workspace.createFileSystemWatcher(pattern), (watcher) => watcher.dispose())

		const next = (type: EventType, uri: vscode.Uri) => {
			const basename = dirname.relative(new Uri(uri))
			this.map.get(basename)?.value.then((subject) => subject.next(type))
		}

		this.stack.adopt(watcher.onDidChange((uri) => next("change", uri)), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidCreate((uri) => next("create", uri)), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidDelete((uri) => next("delete", uri)), (disposable) => disposable.dispose())
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.stack.dispose()
	}
}

export class FileSystemWatcherFactory extends RefCountAsyncDisposableFactory<Uri, DisposableSubject<EventType>> {
	private readonly folderWatchers: RefCountAsyncDisposableFactory<Uri, FolderWatcher>

	constructor() {
		super(
			(uri) => uri.toString(),
			async (uri) => {
				const dirname = uri.dirname()
				const basename = uri.basename()
				const folderWatcher = await this.folderWatchers.get(dirname)
				const fileWatcher = await folderWatcher.get(basename, async () => new DisposableSubject<EventType>(async () => await folderWatcher[Symbol.asyncDispose]()))
				return fileWatcher
			}
		)

		this.folderWatchers = new RefCountAsyncDisposableFactory(
			(dirname) => dirname.toString(),
			async (dirname) => new FolderWatcher(dirname)
		)
	}
}
