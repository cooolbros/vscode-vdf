import { existsSync, readdirSync } from "fs"
import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: Object.fromEntries(
		readdirSync(import.meta.dirname, { withFileTypes: true })
			.filter(i => i.isDirectory() && existsSync(`${i.name}/src/server.ts`))
			.map((server) => [`${server.name.toLowerCase()}`, join(import.meta.dirname, `${server.name}/src/server.ts`)])
	),
	output: {
		path: join(import.meta.dirname, "dist"),
		libraryTarget: "commonjs2"
	},
	resolve: {
		extensions: [".js", ".ts"]
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				use: {
					loader: "ts-loader",
					options: {
						onlyCompileBundledFiles: true
					}
				}
			}
		]
	}
} satisfies Configuration
