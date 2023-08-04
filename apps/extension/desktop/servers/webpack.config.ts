import { readdirSync } from "fs"
import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: Object.fromEntries(
		readdirSync(__dirname, { withFileTypes: true })
			.filter(i => i.isDirectory() && !i.name.startsWith(".") && i.name != "dist")
			.map((server) => [`${server.name.toLowerCase()}`, join(__dirname, `${server.name}/src/server.ts`)])
	),
	output: {
		path: join(__dirname, "dist"),
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
