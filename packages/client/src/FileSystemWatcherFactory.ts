import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { Subject } from "rxjs"
import vscode, { RelativePattern, workspace } from "vscode"

export type EventType = "change" | "create" | "delete"

class DisposableSubject<T> extends Subject<T> implements AsyncDisposable {
	public async [Symbol.asyncDispose](): Promise<void> {
	}
}

class VDFFileSystemWatcher extends RefCountAsyncDisposableFactory<string, DisposableSubject<{ type: EventType, basename: string }>> implements AsyncDisposable {
	private readonly disposables: AsyncDisposableStack

	constructor(base: Uri) {
		const stack = new AsyncDisposableStack()

		const pattern = new RelativePattern(vscode.Uri.parse(base.toString()), "*")
		const watcher = stack.adopt(workspace.createFileSystemWatcher(pattern), (watcher) => watcher.dispose())

		const next = (type: EventType, uri: vscode.Uri) => {
			const basename = base.relative(new Uri(uri))
			this.map.get(basename)?.value.then((subject) => subject.next({ type, basename }))
		}

		stack.adopt(watcher.onDidChange((uri) => next("change", uri)), (disposable) => disposable.dispose())
		stack.adopt(watcher.onDidCreate((uri) => next("create", uri)), (disposable) => disposable.dispose())
		stack.adopt(watcher.onDidDelete((uri) => next("delete", uri)), (disposable) => disposable.dispose())

		super(
			(basename) => basename,
			async (basename, factory) => new DisposableSubject()
		)

		this.disposables = stack.move()
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		return await this.disposables.disposeAsync()
	}
}

export class FileSystemWatcherFactory extends RefCountAsyncDisposableFactory<Uri, VDFFileSystemWatcher> {
	constructor() {
		super(
			(uri) => uri.toString(),
			async (uri) => new VDFFileSystemWatcher(uri)
		)
	}
}
