import { Uri } from "common/Uri"
import { Minimatch } from "minimatch"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"

export async function FolderFileSystem(root: Uri): Promise<FileSystemMountPoint> {

	const stat = await vscode.workspace.fs.stat(root)
	if (stat.type != vscode.FileType.Directory) {
		throw new Error(`${root.toString(true)} is not a directory.`)
	}

	const paths = new Map<string, (uri: Uri | null) => void>()

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(root), "**/**"), false, true, false)

	watcher.onDidCreate((event) => {
		const uri = new Uri(event)
		const path = root.relative(uri).path.substring(1)
		const updater = paths.get(path)
		updater?.(uri)
	})

	watcher.onDidDelete((event) => {
		const uri = new Uri(event)
		const path = root.relative(uri).path.substring(1)
		const updater = paths.get(path)
		updater?.(null)
	})

	return {
		resolveFile: async (path, update) => {
			const uri = root.joinPath(path)

			if (update) {
				paths.set(path, update)
			}

			try {
				const stat = await vscode.workspace.fs.stat(uri)
				if (stat.type == vscode.FileType.Directory) {
					throw vscode.FileSystemError.FileIsADirectory(uri)
				}
				return uri
			}
			catch (error) {
				if (!(error instanceof vscode.FileSystemError) || error.code != "FileNotFound") {
					console.error(error)
				}
				return null
			}
		},
		readDirectory: async (path, options) => {
			if (!options.recursive) {
				return await vscode.workspace.fs.readDirectory(root.joinPath(path))
			}

			const match = options.pattern ? new Minimatch(options.pattern) : null
			const paths: [string, vscode.FileType][] = []

			const iterateDirectory = async (relativePath: string) => {
				const promises: Promise<void>[] = []

				for (const [name, type] of await vscode.workspace.fs.readDirectory(root.joinPath(relativePath))) {

					// Ignore hidden entries
					if (name.startsWith(".")) {
						continue
					}

					const path = relativePath != "" ? `${relativePath}/${name}` : name

					if (match ? match.match(path) : true) {
						paths.push([path, type])
					}

					if (type == vscode.FileType.Directory) {
						promises.push(iterateDirectory(path))
					}
				}

				await Promise.all(promises)
			}

			await iterateDirectory("")
			return paths
		},
		remove: (path) => {
			paths.delete(path)
		},
		dispose: () => {
			watcher.dispose()
		}
	}
}
