import type { Uri } from "common/Uri"
import type { FileSystemMountPoint } from "./FileSystemMountPoint"
import { FolderFileSystem } from "./mounts/FolderFileSystem"
import { TeamFortress2FileSystem } from "./mounts/TeamFortress2FileSystem"
import { VPKFileSystem } from "./mounts/VPKFileSystem"
import { WildcardFileSystem } from "./mounts/WildcardFileSystem"

class FileSystemMountPointFactory {

	private readonly fileSystems = new Map<keyof FileSystemMountPointFactory, Map<string, { value: FileSystemMountPoint, references: number }>>()

	private async resolve<T extends keyof FileSystemMountPointFactory>(type: T, uri: Uri, factory: () => ReturnType<FileSystemMountPointFactory[T]>): Promise<FileSystemMountPoint> {
		let typeFileSystems = this.fileSystems.get(type)
		if (!typeFileSystems) {
			typeFileSystems = new Map()
			this.fileSystems.set(type, typeFileSystems)
		}

		let fileSystem = typeFileSystems.get(uri.toString())

		if (!fileSystem) {
			fileSystem = { value: await factory(), references: 0 }
		}

		fileSystem.references++

		return {
			resolveFile: (path) => fileSystem.value.resolveFile(path),
			readDirectory: (path, options) => fileSystem.value.readDirectory(path, options),
			dispose: () => {
				fileSystem.references--
				if (fileSystem.references == 0) {
					fileSystem.value.dispose()
					typeFileSystems.delete(uri.toString())
					if (typeFileSystems.size == 0) {
						this.fileSystems.delete(type)
					}
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

export const fileSystemMountPointFactory = new FileSystemMountPointFactory()
