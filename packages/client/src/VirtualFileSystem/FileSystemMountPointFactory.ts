import type { Uri } from "common/Uri"
import type { FileSystemMountPoint } from "./FileSystemMountPoint"
import { FolderFileSystem } from "./mounts/FolderFileSystem"
import { TeamFortress2FileSystem } from "./mounts/TeamFortress2FileSystem"
import { VPKFileSystem } from "./mounts/VPKFileSystem"
import { WildcardFileSystem } from "./mounts/WildcardFileSystem"

export class FileSystemMountPointFactory {

	private readonly fileSystems = new Map<keyof FileSystemMountPointFactory, Map<string, { value: FileSystemMountPoint, updaters: Map<string, ((uri: Uri | null) => void)[]>, references: number }>>()

	private async resolve<T extends keyof FileSystemMountPointFactory>(type: T, uri: Uri, factory: () => ReturnType<FileSystemMountPointFactory[T]>): Promise<FileSystemMountPoint> {
		let typeFileSystems = this.fileSystems.get(type)
		if (!typeFileSystems) {
			typeFileSystems = new Map()
			this.fileSystems.set(type, typeFileSystems)
		}

		let fileSystem = typeFileSystems.get(uri.toString())

		if (!fileSystem) {
			fileSystem = { value: await factory(), updaters: new Map(), references: 0 }
		}

		fileSystem.references++

		return {
			resolveFile: async (path, update) => {
				if (update) {
					let updaters = fileSystem.updaters.get(path)
					if (!updaters) {
						updaters = []
						fileSystem.updaters.set(path, updaters)
					}
					updaters.push(update)
				}

				return await fileSystem.value.resolveFile(path, async (uri) => {
					for (const update of fileSystem.updaters.get(path) ?? []) {
						update(uri)
					}
				})
			},
			readDirectory: async (path, options) => {
				return await fileSystem.value.readDirectory(path, options)
			},
			remove: (path) => {
				fileSystem.value.remove(path)
			},
			dispose: () => {
				fileSystem.references--
				if (fileSystem.references == 0) {
					fileSystem.value.dispose()
					typeFileSystems.delete(uri.toString())
				}
			}
		}
	}

	public async folder(root: Uri): Promise<FileSystemMountPoint> {
		return await this.resolve("folder", root, () => FolderFileSystem(root))
	}

	public async tf2(teamFortress2Folder: Uri): Promise<FileSystemMountPoint> {
		return await this.resolve("tf2", teamFortress2Folder, () => TeamFortress2FileSystem(teamFortress2Folder, this))
	}

	public async vpk(vpk: Uri): Promise<FileSystemMountPoint> {
		return await this.resolve("vpk", vpk, () => VPKFileSystem(vpk))
	}

	public async wildcard(uri: Uri): Promise<FileSystemMountPoint> {
		return await this.resolve("wildcard", uri, () => WildcardFileSystem(uri, this))
	}
}
