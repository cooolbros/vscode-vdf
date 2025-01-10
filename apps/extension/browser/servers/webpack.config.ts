import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: Object.fromEntries(
		readdirSync(import.meta.dirname, { withFileTypes: true })
			.filter(i => i.isDirectory() && existsSync(`${i.name}/src/server.ts`))
			.map((server) => [`${server.name.toLowerCase()}`, join(import.meta.dirname, `${server.name}/src/server.ts`)])
	),
	output: {
		path: join(import.meta.dirname, "dist"),
		libraryTarget: "var",
		library: "serverExportVar",
	},
	resolve: {
		extensions: [".js", ".ts"],
		fallback: {
			"path": fileURLToPath(import.meta.resolve("path-browserify"))
		}
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
	},
	performance: {
		hints: false
	}
} satisfies Configuration
