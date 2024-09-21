import type { Uri } from "common/Uri"
import { VDF } from "vdf"
import * as vscode from "vscode"
import { z } from "zod"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "../FileSystemMountPointFactory"

export async function TeamFortress2FileSystem(teamFortress2Folder: Uri, factory: FileSystemMountPointFactory): Promise<FileSystemMountPoint> {

	function invalid(): never {
		throw new Error("Invalid gameinfo.txt")
	}

	const gameInfo = VDF.parse(new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(teamFortress2Folder.joinPath("tf/gameinfo.txt"))))[0]

	if (typeof gameInfo.value == "string") {
		invalid()
	}

	const result = z.tuple([
		z.object({ key: z.literal("SteamAppId"), value: z.literal("440") }),
		z.object({ key: z.literal("SearchPaths"), value: z.array(z.object({ key: z.string(), value: z.string() })) })
	]).safeParse(gameInfo.value.find((kv) => kv.key == "FileSystem")?.value)

	if (!result.success) {
		invalid()
	}

	const [, { value: searchPaths }] = result.data

	const uris = searchPaths.map(({ value }) => {
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

	const paths = new Map<string, { uris: (Uri | null)[], index: number }>()

	return {
		resolveFile: async (path, update) => {

			const uris = await Promise.all(fileSystems.map((fileSystem, index) => fileSystem.resolveFile(path, update == null ? null : async (uri) => {
				const result = paths.get(path)
				if (!result) {
					return
				}

				const prev = result.uris[result.index]

				result.uris[index] = uri
				result.index = uris.findIndex((uri) => uri != null)

				const newUri = uris[result.index] ?? null
				if (!prev?.equals(newUri)) {
					update(newUri)
				}
			})))

			const index = uris.findIndex((uri) => uri != null)
			paths.set(path, { uris: uris, index: index })
			return uris[index] ?? null
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
				}, <[string, number][]>[])
		},
		remove: (path) => {
			paths.delete(path)
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
