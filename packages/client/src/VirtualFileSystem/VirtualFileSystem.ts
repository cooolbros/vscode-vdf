import type { FileSystemMountPoint } from "./FileSystemMountPoint"

export function VirtualFileSystem(fileSystems: FileSystemMountPoint[]): FileSystemMountPoint {
	return {
		resolveFile: async (path, update) => {
			const uris = await Promise.all(fileSystems.map((fileSystem) => fileSystem.resolveFile(path, update)))
			return uris.find((uri) => uri != null) ?? null
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
