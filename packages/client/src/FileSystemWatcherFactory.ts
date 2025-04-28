import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import { concatMap, debounceTime, Observable, share } from "rxjs"
import vscode, { RelativePattern, workspace } from "vscode"

export class FileSystemWatcherFactory extends RefCountAsyncDisposableFactory<Uri, Observable<Uint8Array> & { [Symbol.asyncDispose](): Promise<void> }> {

	constructor() {
		super(
			(uri) => uri.toString(),
			async (uri) => {
				const segments = uri.toString().split("/")
				const basename = segments.pop()!

				const observable = new Observable<void>((subscriber) => {
					const watcher = workspace.createFileSystemWatcher(new RelativePattern(vscode.Uri.parse(segments.join("/")), basename), true, false, true)
					watcher.onDidChange(() => subscriber.next())
					return () => watcher.dispose()
				}).pipe(
					debounceTime(100),
					concatMap(async () => await workspace.fs.readFile(uri)),
					share()
				)

				return new Proxy<Observable<Uint8Array> & { [Symbol.asyncDispose](): Promise<void> }>(observable as any, {
					get: (target, p, receiver) => {
						if (p != Symbol.asyncDispose) {
							return Reflect.get(target, p, receiver)
						}
						else {
							return async () => { }
						}
					}
				})
			}
		)
	}
}
