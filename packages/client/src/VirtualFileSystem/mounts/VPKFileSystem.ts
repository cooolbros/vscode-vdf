import { Uri } from "common/Uri"
import { Minimatch } from "minimatch"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"

/**
 * @class
 */
export async function VPKFileSystem(vpk: Uri): Promise<FileSystemMountPoint> {

	const stat = await vscode.workspace.fs.stat(vpk)
	if (stat.type != vscode.FileType.File) {
		throw new Error(`${vpk.toString(true)} is not a file.`)
	}

	const authority = JSON.stringify(vpk)

	return {
		resolveFile: async (path, update) => {
			try {
				const uri = new Uri({ scheme: "vpk", authority: authority, path: `/${path}`, query: "", fragment: "" })
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
				const uri = new Uri({ scheme: "vpk", authority: authority, path: `/${path}`, query: "", fragment: "" })
				return await vscode.workspace.fs.readDirectory(uri)
			}

			const match = options.pattern ? new Minimatch(options.pattern) : null
			const paths: [string, vscode.FileType][] = []

			const iterateDirectory = async (relativePath: string) => {
				const promises: Promise<void>[] = []

				for (const [name, type] of await vscode.workspace.fs.readDirectory(new Uri({ scheme: "vpk", authority: authority, path: `/${relativePath}`, query: "", fragment: "" }))) {

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
		remove: (path) => {
		},
		dispose: () => {
		}
	}
}
