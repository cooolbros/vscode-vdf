import { posix } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: {
		extension: [
			import.meta.resolve("disposablestack/auto"),
			posix.join(import.meta.dirname, "src/extension.ts")
		]
	},
	experiments: {
		asyncWebAssembly: true,
		syncWebAssembly: true,
	},
	output: {
		path: posix.join(import.meta.dirname, "dist"),
		libraryTarget: "commonjs2",
		clean: true,
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
				resourceQuery: /url/,
				type: "asset/resource",
			}
		]
	}
} satisfies Configuration
