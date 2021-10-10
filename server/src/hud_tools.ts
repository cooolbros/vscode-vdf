import * as fs from "fs"
import * as path from "path"
import { merge } from "./merge"
import { VDF } from "./vdf"

export class HUDTools {
	static GetRoot(filePath: string): string | null {
		const folders = filePath.split(/[/\\]+/)
		let i: number = folders.length
		while (i >= 0) {
			const folderPath = folders.slice(0, i).join('/')
			if (fs.existsSync(`${folderPath}/info.vdf`)) {
				return folderPath
			}
			i--;
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