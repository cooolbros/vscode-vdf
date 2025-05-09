import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { Minimatch } from "minimatch"
import { posix } from "path"
import { catchError, concat, from, map, of, Subject } from "rxjs"
import vscode from "vscode"

export async function VSCodeFileSystem(
	root: Uri,
	type: vscode.FileType,
	watch: boolean,
	resolvePath: (path: string) => Uri,
): Promise<FileSystemMountPoint> {

	const stat = await vscode.workspace.fs.stat(root)
	if (stat.type != type) {
		throw new Error(`${root.toString(true)} is not a ${type}.`)
	}

	const subjects = new Map<string, Subject<Uri | null>>()
	let watcher: vscode.FileSystemWatcher

	if (watch) {
		watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(root), "**/**"), false, true, false)

		watcher.onDidCreate(async (event) => {
			const stat = await vscode.workspace.fs.stat(event)
			if (stat.type == vscode.FileType.File) {
				const uri = new Uri(event)
				const path = root.relative(uri)
				subjects.get(path)?.next(uri)
			}
		})

		watcher.onDidDelete((event) => {
			const uri = new Uri(event)
			const path = root.relative(uri)
			subjects.get(path)?.next(null)
		})
	}

	return {
		resolveFile: (path) => {
			const uri = resolvePath(path)

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
						if (!(error instanceof vscode.FileSystemError) || (error.code != "FileNotFound" && error.code != "FileIsADirectory")) {
							console.error(error)
						}
						return of(null)
					})
				),
				subject
			)
		},
		readDirectory: async (path, options) => {

			const match = options.pattern ? new Minimatch(options.pattern) : null
			const paths: [string, vscode.FileType][] = []

			const uri = resolvePath(path)
			const exists = await vscode.workspace.fs.stat(uri).then((stat) => stat.type == vscode.FileType.Directory, () => false)
			if (!exists) {
				return paths
			}

			if (!options.recursive) {
				// Add files and directories

				for (const [name, type] of await vscode.workspace.fs.readDirectory(uri)) {
					// Ignore hidden entries
					if (name.startsWith(".")) {
						continue
					}

					if (type == vscode.FileType.File) {
						if (match ? match.match(name) : true) {
							paths.push([name, type])
						}
					}
					else {
						paths.push([name, type])
					}
				}
			}
			else {
				// Add files only, relative to path, recursively

				const rootPath = path

				const iterateDirectory = async (relativePath: string) => {
					const promises: Promise<void>[] = []

					for (const [name, type] of await vscode.workspace.fs.readDirectory(resolvePath(posix.join(rootPath, relativePath)))) {

						// Ignore hidden entries
						if (name.startsWith(".")) {
							continue
						}

						const path = posix.join(relativePath, name)

						if (type == vscode.FileType.File) {
							if (match ? match.match(path) : true) {
								paths.push([path, type])
							}
						}

						if (type == vscode.FileType.Directory) {
							promises.push(iterateDirectory(path))
						}
					}

					await Promise.all(promises)
				}

				await iterateDirectory("")
			}

			return paths
		},
		async [Symbol.asyncDispose]() {
			watcher?.dispose()
		}
	}
}
