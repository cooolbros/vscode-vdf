import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "webworker",
	entry: {
		extension: join(__dirname, "src/extension.ts")
	},
	output: {
		path: join(__dirname, "dist"),
		libraryTarget: "commonjs"
	},
	externals: {
		vscode: "commonjs vscode"
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
