import { Uri } from "common/Uri"
import type { FileSystemMountPoint } from "./FileSystemMountPoint"

/**
 * @class
 */
export function VirtualFileSystem(fileSystems: FileSystemMountPoint[]): FileSystemMountPoint {

	const paths = new Map<string, { uris: (Uri | null)[], index: number }>()

	return {
		resolveFile: async (path) => {

			const uris = await Promise.all(
				fileSystems.map((fileSystem, index) => fileSystem.resolveFile(path).catch(() => null))
			)

			const index = uris.findIndex((uri) => uri != null)
			paths.set(path, { uris: uris, index: index })
			return uris[index] ?? null
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
