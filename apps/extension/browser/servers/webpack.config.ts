import { readdirSync } from "fs"
import { posix } from "path"
import { fileURLToPath } from "url"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: Object.fromEntries(readdirSync("src").map((name) => [posix.parse(name).name, posix.join(import.meta.dirname, `src/${name}`)])),
	output: {
		path: posix.join(import.meta.dirname, "dist"),
		libraryTarget: "var",
		library: "serverExportVar",
		clean: true,
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
