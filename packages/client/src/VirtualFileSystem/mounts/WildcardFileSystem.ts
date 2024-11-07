import { Uri } from "common/Uri"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "../FileSystemMountPointFactory"

class SortedArray<T> extends Array<T> {

	constructor(private readonly compareFn: (a: T, b: T) => number, ...items: T[]) {
		super(...items.sort(compareFn))
	}

	private update() {
		this.sort(this.compareFn)
	}

	public push(...items: T[]): number {
		const length = super.push(...items)
		this.update()
		return length
	}

	public splice(start: number, deleteCount: number, ...items: T[]): T[] {
		const deleted = super.splice(start, deleteCount, ...items)
		this.update()
		return deleted
	}

	map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[] {
		return this.values().map((value, index) => callbackfn(value, index, this)).toArray()
	}
}

/**
 * @class
 */
export async function WildcardFileSystem(uri: Uri, factory: FileSystemMountPointFactory): Promise<FileSystemMountPoint> {

	if (uri.basename() != "*") {
		throw new Error(`${uri} is not a *.`)
	}

	const dirname = uri.dirname()

	const fileSystems = new SortedArray<{ folder: string, fileSystem: FileSystemMountPoint }>(
		(a, b) => a.folder.localeCompare(b.folder),
		...(await Promise.allSettled(
			(await vscode.workspace.fs.readDirectory(dirname))
				.map(async ([name, type]) => {

					let fileSystem: FileSystemMountPoint | null = null

					if (type == vscode.FileType.Directory) {
						fileSystem = await factory.folder(dirname.joinPath(name))
					}

					if (name.endsWith(".vpk")) {
						fileSystem = await factory.vpk(dirname.joinPath(name))
					}

					if (!fileSystem) {
						throw new Error()
					}

					return {
						folder: name,
						fileSystem: fileSystem
					}
				})
		))
			.filter((fileSystem) => fileSystem.status == "fulfilled")
			.map((fileSystem) => fileSystem.value)
	)

	const paths = new Map<string, { uris: SortedArray<{ folder: string, uri: Uri | null }>, folder: string | null, updater: (folder: string, uri: Uri | null) => void }>()

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(dirname), "*"), false, true, false)

	watcher.onDidCreate(async (event) => {
		const uri = new Uri(event)
		const basename = uri.basename()

		if ((await vscode.workspace.fs.stat(uri)).type == vscode.FileType.Directory && !fileSystems.some(({ folder }) => folder == basename)) {
			const fileSystem = { folder: basename, fileSystem: await factory.folder(uri) }
			fileSystems.push(fileSystem)
			for (const [path, result] of paths.entries()) {
				fileSystem.fileSystem.resolveFile(path, (uri) => result.updater(basename, uri)).then((uri) => {
					result.uris.push({ folder: basename, uri: uri })
					result.updater(basename, uri)
				})
			}
		}
	})

	watcher.onDidDelete(async (event) => {
		const uri = new Uri(event)
		const basename = uri.basename()

		if ((await vscode.workspace.fs.stat(uri)).type == vscode.FileType.Directory) {
			const fileSystem = fileSystems.find(({ folder }) => folder == basename)
			if (fileSystem) {
				fileSystem.fileSystem.dispose()
				fileSystems.splice(fileSystems.indexOf(fileSystem), 1)
			}
		}
	})

	return {
		resolveFile: async (path, update) => {

			const updater = async (folder: string, uri: Uri | null) => {
				const result = paths.get(path)
				if (!result) {
					return
				}

				const prev = result.uris.find(({ folder: f }) => f == result.folder)?.uri ?? null

				const caller = result.uris.find(({ folder: f }) => f == folder)
				if (caller) {
					caller.uri = uri
				}
				result.folder = result.uris.find(({ uri }) => uri != null)?.folder ?? null

				const newUri = result.uris.find(({ folder: f }) => f == result.folder)?.uri ?? null
				if (!prev?.equals(newUri)) {
					update?.(newUri)
				}
			}

			const uris = fileSystems.length != 0
				? await Promise.all(fileSystems.map(async ({ folder, fileSystem }) => ({ folder: folder, uri: await fileSystem.resolveFile(path, (uri) => updater(folder, uri)) })))
				: []

			const result = uris.find(({ uri }) => uri != null) ?? null
			paths.set(path, {
				uris: new SortedArray((a, b) => a.folder.localeCompare(b.folder), ...uris),
				folder: result?.folder ?? null,
				updater: updater,
			})

			return result?.uri ?? null
		},
		readDirectory: async (path, options) => {
			const all = (await Promise.all(fileSystems.map(({ fileSystem }) => fileSystem.readDirectory(path, options)))).flat()
			return all.filter(([name], index) => all.findIndex(([n]) => n == name) == index)
		},
		remove: (path) => {
			for (const { fileSystem } of fileSystems) {
				fileSystem.remove(path)
			}
		},
		dispose: () => {
			watcher.dispose()
			for (const { fileSystem } of fileSystems) {
				fileSystem?.dispose()
			}
		}
	}
}
