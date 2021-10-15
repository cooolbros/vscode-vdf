import * as fs from "fs"
import * as path from "path"
import { fileURLToPath, URL } from "url"
import { merge } from "./merge"
import { VDF } from "./vdf"

export class HUDTools {

	/**
	 * Resolve root folder of an absolute HUD file path
	 * @param uri File uri containing object.
	 * @returns The root of the HUD folder as a file path string (`C:/...`)
	 */
	static GetRoot({ uri }: { uri: string }): string | null {
		let folderPath = fileURLToPath(uri)
		while (folderPath != `${new URL(folderPath).protocol}\\`) {
			if (fs.existsSync(`${folderPath}/info.vdf`)) {
				return folderPath
			}
			folderPath = path.dirname(folderPath)
		}
		return null
	}

	static loadControls(filePath: string): any {
		const origin: object = {}
		const addControls = (filePath: string) => {
			const obj = fs.existsSync(filePath) ? VDF.parse(fs.readFileSync(filePath, "utf-8")) : {}
			if (obj.hasOwnProperty("#base")) {
				const baseFiles: string[] = Array.isArray(obj["#base"]) ? obj["#base"] : [obj["#base"]]
				const folder = path.dirname(filePath)
				for (const baseFile of baseFiles) {
					addControls(`${folder}/${baseFile}`)
				}
			}
			merge(origin, obj)
		}
		addControls(filePath)
		return origin
	}
}