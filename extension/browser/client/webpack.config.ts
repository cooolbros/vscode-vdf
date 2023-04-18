import { join } from "path"
import type { Configuration } from "webpack"

export const browserClientConfiguration: Configuration = {
	mode: "production",
	target: "webworker",
	entry: {
		extension: join(__dirname, "src/extension.ts")
	},
	output: {
		path: join(process.cwd(), "dist/browser"),
		libraryTarget: "commonjs"
	},
	externals: {
		vscode: "commonjs vscode"
	},
	resolve: {
		extensions: [".js", ".ts"],
		alias: {
			"$lib": join(process.cwd(), "extension/lib")
		},
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
}
