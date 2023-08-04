import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: {
		extension: join(__dirname, "src/extension.ts")
	},
	output: {
		path: join(__dirname, "dist"),
		libraryTarget: "commonjs2"
	},
	externals: {
		vscode: "commonjs vscode"
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
