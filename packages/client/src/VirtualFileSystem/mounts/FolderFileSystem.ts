import { Uri } from "common/Uri"
import { Minimatch } from "minimatch"
import { catchError, concat, from, map, of, Subject } from "rxjs"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"

/**
 * @class
 */
export async function FolderFileSystem(root: Uri): Promise<FileSystemMountPoint> {

	const stat = await vscode.workspace.fs.stat(root)
	if (stat.type != vscode.FileType.Directory) {
		throw new Error(`${root.toString(true)} is not a directory.`)
	}

	const subjects = new Map<string, Subject<Uri | null>>()

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(root), "**/**"), false, true, false)

	watcher.onDidCreate(async (event) => {
		const stat = await vscode.workspace.fs.stat(event)
		if (stat.type == vscode.FileType.File) {
			const uri = new Uri(event)
			const path = root.relative(uri).path.substring(1)
			subjects.get(path)?.next(uri)
		}
	})

	watcher.onDidDelete((event) => {
		const uri = new Uri(event)
		const path = root.relative(uri).path.substring(1)
		subjects.get(path)?.next(null)
	})

	return {
		resolveFile: (path) => {
			const uri = root.joinPath(path)

			let subject = subjects.get(path)
			if (!subject) {
				subject = new Subject<Uri | null>()
				subjects.set(path, subject)
			}

			return concat(
				from(vscode.workspace.fs.stat(uri)).pipe(
					map((stat) => {
						if (stat.type == vscode.FileType.Directory) {
							throw vscode.FileSystemError.FileIsADirectory(uri)
						}
						return uri
					}),
					catchError((error) => {
						if (!(error instanceof vscode.FileSystemError) || error.code != "FileNotFound") {
							console.error(error)
						}
						return of(null)
					})
				),
				subject
			)
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

			await iterateDirectory(path)
			return paths
		},
		dispose: () => {
			watcher.dispose()
		}
	}
}
