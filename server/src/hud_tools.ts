import * as fs from "fs"

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
}