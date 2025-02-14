import { Uri } from "common/Uri"
import { combineLatest, defer, distinctUntilChanged, map, Observable, of, shareReplay } from "rxjs"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "./FileSystemMountPoint"

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
					distinctUntilChanged(Uri.equals),
					shareReplay(1)
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
		dispose: () => {
			for (const fileSystem of fileSystems) {
				fileSystem.dispose()
			}
		}
	}
}
