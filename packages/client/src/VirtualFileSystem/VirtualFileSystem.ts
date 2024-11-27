import type { Uri } from "common/Uri"
import { combineLatest, map, Observable } from "rxjs"
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
				observable = combineLatest(fileSystems.map((fileSystem) => fileSystem.resolveFile(path))).pipe(
					map((uris) => uris.find((uri) => uri != null) ?? null)
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
				}, <[string, number][]>[])
		},
		dispose: () => {
			for (const fileSystem of fileSystems) {
				fileSystem.dispose()
			}
		}
	}
}
