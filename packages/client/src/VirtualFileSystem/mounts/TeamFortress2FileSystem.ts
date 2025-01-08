import { Uri } from "common/Uri"
import { combineLatest, distinctUntilChanged, map, Observable, shareReplay } from "rxjs"
import { VDF } from "vdf"
import * as vscode from "vscode"
import { z } from "zod"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "../FileSystemMountPointFactory"

/**
 * @class
 */
export async function TeamFortress2FileSystem(teamFortress2Folder: Uri, factory: FileSystemMountPointFactory): Promise<FileSystemMountPoint> {

	const gameInfo = VDF.parse(new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(teamFortress2Folder.joinPath("tf/gameinfo.txt"))))

	const result = z.object({
		GameInfo: z.object({
			FileSystem: z.object({
				SearchPaths: z.record(z.union([z.string(), z.array(z.string())]))
			})
		})
	}).safeParse(gameInfo)

	if (!result.success) {
		console.error(result.error)
		throw new Error("Invalid gameinfo.txt", { cause: result.error })
	}

	const { GameInfo: { FileSystem: { SearchPaths: searchPaths } } } = result.data

	const uris = Object
		.values(searchPaths)
		.flatMap((i) => Array.isArray(i) ? i : [i])
		.map((value) => {
			const relativePath = value
				.replace("|all_source_engine_paths|", "")
				.replace("|gameinfo_path|", "tf/")

			return teamFortress2Folder.joinPath(relativePath)
		})

	const fileSystems = (
		await Promise.allSettled(
			uris
				.filter((uri, index) => uris.findIndex((u) => u.equals(uri)) == index)
				.map(async (uri) => {
					try {
						const basename = uri.basename()

						if (basename == "*") {
							return await factory.wildcard(uri)
						}

						if (basename.endsWith(".vpk")) {
							const vpk = uri.dirname().joinPath(basename.replace(".vpk", "_dir.vpk"))

							return await factory.vpk(vpk)
						}

						return await factory.folder(uri)
					}
					catch (error) {
						if (!(error instanceof vscode.FileSystemError) || error.code != "FileNotFound") {
							console.error(error)
						}

						throw error
					}
				})
		)
	)
		.filter((result) => result.status == "fulfilled")
		.map((result) => result.value)

	if (fileSystems.length == 0) {
		throw new Error()
	}

	const observables = new Map<string, Observable<Uri | null>>()

	return {
		resolveFile: (path) => {
			let observable = observables.get(path)
			if (!observable) {
				observable = combineLatest(fileSystems.map((fileSystem) => fileSystem.resolveFile(path))).pipe(
					map((uris) => uris.find((uri) => uri != null) ?? null),
					distinctUntilChanged(Uri.equals),
					shareReplay(1)
				)
				observables.set(path, observable)
			}
			return observable
		},
		readDirectory: async (path, options) => {
			const results = await Promise.allSettled(fileSystems.map((fileSystem) => fileSystem.readDirectory(path, options)))

			return results
				.values()
				.filter((result) => result.status == "fulfilled")
				.map((result) => result.value)
				.flatMap((value) => value)
				.reduce((a, b) => {
					if (!a.some(([n]) => n == b[0])) {
						a.push(b)
					}
					return a
				}, <[string, vscode.FileType][]>[])
		},
		dispose: () => {
			for (const fileSystem of fileSystems) {
				fileSystem.dispose()
			}
		}
	}
}
