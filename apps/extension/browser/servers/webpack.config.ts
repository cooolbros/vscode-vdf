import { existsSync, readdirSync } from "fs"
import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: Object.fromEntries(
		readdirSync(__dirname, { withFileTypes: true })
			.filter(i => i.isDirectory() && existsSync(`${i.name}/src/server.ts`))
			.map((server) => [`${server.name.toLowerCase()}`, join(__dirname, `${server.name}/src/server.ts`)])
	),
	output: {
		path: join(__dirname, "dist"),
		libraryTarget: "var",
		library: "serverExportVar",
	},
	resolve: {
		extensions: [".js", ".ts"],
		fallback: {
			"path": require.resolve("path-browserify")
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
