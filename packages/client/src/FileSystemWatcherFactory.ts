import { EntryType } from "common/FileSystemMountPoint"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { WatchEvent } from "common/WatchEvent"
import { Subject } from "rxjs"
import vscode from "vscode"

class DisposableSubject<T> extends Subject<T> implements AsyncDisposable {

	private readonly disposeAsync: () => Promise<void>

	public constructor(disposeAsync: () => Promise<void>) {
		super()
		this.disposeAsync = disposeAsync
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.disposeAsync()
	}
}

class FolderWatcher extends RefCountAsyncDisposableFactory<string, DisposableSubject<WatchEvent>> implements AsyncDisposable {

	private readonly stack: DisposableStack

	public constructor(dirname: Uri) {
		super(
			(basename) => basename,
			async (_basename, _factory) => { throw new Error("unreachable") }
		)

		this.stack = new DisposableStack()

		const pattern = new vscode.RelativePattern(vscode.Uri.parse(dirname.toString()), "*")
		const watcher = this.stack.adopt(vscode.workspace.createFileSystemWatcher(pattern), (watcher) => watcher.dispose())

		const onStat = async (type: Exclude<WatchEvent["type"], "delete">, event: vscode.Uri) => {
			const uri = new Uri(event)
			switch ((await vscode.workspace.fs.stat(event)).type) {
				case vscode.FileType.File:
					await next(uri, { type: type, entry: { type: <const>EntryType.File, uri: uri } })
					break
				case vscode.FileType.Directory:
					await next(uri, { type: type, entry: { type: <const>EntryType.Directory, uri: uri } })
					break
			}
		}

		const onDelete = async (event: vscode.Uri) => {
			const uri = new Uri(event)
			await next(uri, { type: "delete", entry: { type: EntryType.None, uri: null } })
		}

		const next = async (uri: Uri, event: WatchEvent) => {
			const basename = dirname.relative(uri)
			return await this.map.get(basename)?.value.then((subject) => subject.next(event))
		}

		this.stack.adopt(watcher.onDidCreate(async (event) => await onStat("create", event)), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidChange(async (event) => await onStat("change", event)), (disposable) => disposable.dispose())
		this.stack.adopt(watcher.onDidDelete(async (event) => await onDelete(event)), (disposable) => disposable.dispose())
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.stack.dispose()
	}
}

export class FileSystemWatcherFactory extends RefCountAsyncDisposableFactory<Uri, DisposableSubject<WatchEvent>> {
	private readonly folderWatchers: RefCountAsyncDisposableFactory<Uri, FolderWatcher>

	public constructor() {
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
