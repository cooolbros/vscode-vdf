import type { Uri } from "common/Uri"
import type { FileSystemMountPoint } from "./FileSystemMountPoint"

export function VirtualFileSystem(fileSystems: FileSystemMountPoint[]): FileSystemMountPoint {

	const paths = new Map<string, { uris: (Uri | null)[], index: number }>()

	return {
		resolveFile: async (path, update) => {

			const uris = await Promise.all(fileSystems.map((fileSystem, index) => fileSystem.resolveFile(path, update == null ? null : (uri) => {
				const result = paths.get(path)
				if (!result) {
					return
				}

				const prev = result.uris[result.index]

				result.uris[index] = uri
				result.index = uris.findIndex((uri) => uri != null)

				const newUri = uris[result.index] ?? null
				if (!prev?.equals(newUri)) {
					update(newUri)
				}
			})))

			const index = uris.findIndex((uri) => uri != null)
			paths.set(path, { uris: uris, index: index })
			return uris[index] ?? null
		},
		readDirectory: async (path, options) => {
			const all = (await Promise.all(fileSystems.map((fileSystem) => fileSystem.readDirectory(path, options)))).flat()
			return all.filter(([name], index) => all.findIndex(([n]) => n == name) == index)
		},
		remove: (path) => {
			for (const fileSystem of fileSystems) {
				fileSystem.remove(path)
			}
		},
		dispose: () => {
			for (const fileSystem of fileSystems) {
				fileSystem.dispose()
			}
		}
	}
}
