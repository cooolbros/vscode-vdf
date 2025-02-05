import { join } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: {
		extension: join(import.meta.dirname, "src/extension.ts")
	},
	experiments: {
		asyncWebAssembly: true,
		syncWebAssembly: true,
	},
	output: {
		path: join(import.meta.dirname, "dist"),
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
			},
			{
				resourceQuery: /raw/,
				type: "asset/source",
			}
		]
	}
} satisfies Configuration
