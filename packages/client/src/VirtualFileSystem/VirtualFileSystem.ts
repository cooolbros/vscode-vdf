import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { combineLatest, defer, distinctUntilChanged, finalize, map, Observable, of, shareReplay } from "rxjs"
import vscode from "vscode"

/**
 * @class
 */
export function VirtualFileSystem(fileSystems: FileSystemMountPoint[]): FileSystemMountPoint {
	const observables = new Map<string, Observable<Uri | null>>()
	return {
		resolveFile: (path) => {
			let observable = observables.get(path)
			if (!observable) {
				observable = defer(() => {
					return fileSystems.length != 0
						? combineLatest(fileSystems.map((fileSystem) => fileSystem.resolveFile(path)))
						: of([])
				}).pipe(
					map((uris) => uris.find((uri) => uri != null) ?? null),
					distinctUntilChanged((a, b) => Uri.equals(a, b)),
					finalize(() => observables.delete(path)),
					shareReplay({ bufferSize: 1, refCount: true })
				)
				observables.set(path, observable)
			}
			return observable
		},
		readDirectory: async (path, options) => {
			const results = await Promise.allSettled(fileSystems.map((fileSystem) => fileSystem.readDirectory(path, options)))

			return results
				.values()
				.filter((result) => result.status == "fulfilled")
				.map((result) => result.value)
				.flatMap((value) => value)
				.reduce((a, b) => {
					if (!a.some(([n]) => n == b[0])) {
						a.push(b)
					}
					return a
				}, <[string, vscode.FileType][]>[])
		},
		[Symbol.asyncDispose]: async () => {
			for (const fileSystem of fileSystems) {
				fileSystem[Symbol.asyncDispose]()
			}
		}
	}
}
