import { posix } from "path"
import { fileURLToPath } from "url"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: {
		extension: posix.join(import.meta.dirname, "src/extension.ts")
	},
	experiments: {
		asyncWebAssembly: true,
		syncWebAssembly: true,
	},
	output: {
		path: posix.join(import.meta.dirname, "dist"),
		libraryTarget: "commonjs",
		clean: true,
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
			},
			{
				resourceQuery: /url/,
				type: "asset/resource",
			}
		]
	},
	performance: {
		hints: false
	}
} satisfies Configuration
