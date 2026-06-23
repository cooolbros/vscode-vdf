import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { Minimatch } from "minimatch"
import { posix } from "path"
import { catchError, concat, from, map, of, Subject } from "rxjs"
import vscode, { FileType } from "vscode"

interface VSCodeFileSystem {
	root: Uri,
	type: vscode.FileType,
	watch: boolean,
	resolvePath: (path: string) => Uri,
}

export async function VSCodeFileSystem({ root, type, watch, resolvePath }: VSCodeFileSystem): Promise<FileSystemMountPoint> {

	const stat = await vscode.workspace.fs.stat(root)
	if (stat.type != type) {
		throw new Error(`${root.toString(true)} is not a ${type}.`)
	}

	const subjects = new Map<string, Subject<Entry>>()
	let watcher: vscode.FileSystemWatcher

	if (watch) {
		watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(root), "**/**"), false, true, false)

		watcher.onDidCreate(async (event) => {
			const uri = new Uri(event)
			const path = root.relative(uri)
			const stat = await vscode.workspace.fs.stat(event)
			switch (stat.type) {
				case FileType.File:
					subjects.get(path)?.next({ type: EntryType.File, uri: uri })
					break
				case FileType.Directory:
					subjects.get(path)?.next({ type: EntryType.Directory, uri: uri })
					break
			}
		})

		watcher.onDidDelete((event) => {
			const uri = new Uri(event)
			const path = root.relative(uri)
			subjects.get(path)?.next({ type: EntryType.None, uri: null })
		})
	}

	return {
		resolve: (path) => {
			const uri = resolvePath(path)

			let subject = subjects.get(path)
			if (!subject) {
				subject = new Subject<Entry>()
				subjects.set(path, subject)
			}

			return concat(
				from(vscode.workspace.fs.stat(uri)).pipe(
					map((stat) => {
						switch (stat.type) {
							case FileType.File:
								return { type: <const>EntryType.File, uri }
							case FileType.Directory:
								return { type: <const>EntryType.Directory, uri }
							/**
							 * *Note:* This value might be a bitmask, e.g. `FileType.File | FileType.SymbolicLink`.
							 */
							default:
								return { type: <const>EntryType.None, uri: null }
						}
					}),
					catchError((error) => {
						if (!(error instanceof vscode.FileSystemError) || (error.code != "FileNotFound" && error.code != "FileIsADirectory")) {
							console.error(error)
						}
						return of<Entry>({ type: EntryType.None, uri: null })
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
