import { VDF } from "vdf"
import { z } from "zod"
import type { Uri } from "./Uri"

export class GameInfo {

	public readonly uri: Uri
	public readonly searchPaths: Uri[]

	constructor(uri: Uri, text: string) {
		this.uri = uri

		const gameInfo = VDF.parse(text)

		const result = z.object({
			GameInfo: z.object({
				FileSystem: z.object({
					SearchPaths: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
				})
			})
		}).safeParse(gameInfo)

		if (!result.success) {
			console.error(result.error)
			throw new Error("Invalid gameinfo.txt", { cause: result.error })
		}

		const { GameInfo: { FileSystem: { SearchPaths: searchPaths } } } = result.data

		this.searchPaths = Object
			.values(searchPaths)
			.flatMap((i) => Array.isArray(i) ? i : [i])
			.map((value) => {
				const relativePath = value
					.replace("|all_source_engine_paths|", "")
					.replace("|gameinfo_path|", "tf/")

				return this.uri.joinPath(relativePath)
			})
	}

	public relative(uri: Uri) {
		const results = this.searchPaths
			.values()
			.map((searchPath) => {
				if (searchPath.basename() == "*") {
					const folder = searchPath.dirname()
					if (folder.relative(uri).startsWith("..")) {
						return null
					}

					const segments = folder.relative(uri).split("/")
					segments.shift()
					return segments.join("/")
				}
				else if (searchPath.extname() == ".vpk") {
					return null
				}
				else {
					return searchPath.relative(uri)
				}
			})
			.filter((path) => path != null)
			.toArray()
			.toSorted((a, b) => a.length - b.length)

		return results[0]
	}
}
