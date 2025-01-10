import { join } from "path"
import { fileURLToPath } from "url"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: {
		extension: join(import.meta.dirname, "src/extension.ts")
	},
	output: {
		path: join(import.meta.dirname, "dist"),
		libraryTarget: "commonjs"
	},
	externals: {
		vscode: "commonjs vscode"
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
