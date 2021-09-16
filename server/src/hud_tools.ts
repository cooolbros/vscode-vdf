import * as fs from "fs"
import * as path from "path"
import { merge } from "./merge"
import { VDF } from "./vdf"

export class HUDTools {
	static GetRoot(filePath: string, connection: any): string | undefined {
		// connection.console.log(`Finding root of ${filePath}`)
		const folders = filePath.split(/[/\\]+/)
		let i: number = folders.length
		while (i >= 0) {
			const folderPath = folders.slice(0, i).join('/')
			// connection.console.log(`Testing ${folderPath}/info.vdf`)
			if (fs.existsSync(`${folderPath}/info.vdf`)) {
				// connection.console.log(`Found ${folderPath}`)
				return folderPath
			}
			i--;
		}
		return undefined
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