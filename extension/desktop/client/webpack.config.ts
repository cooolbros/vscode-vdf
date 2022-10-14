import { join } from "path"
import type { Configuration } from "webpack"

export const desktopClientConfiguration: Configuration = {
	mode: "production",
	target: "node",
	entry: {
		extension: join(__dirname, "src/extension.ts")
	},
	output: {
		path: join(process.cwd(), "dist/desktop"),
		libraryTarget: "commonjs2"
	},
	externals: {
		vscode: "commonjs vscode"
	},
	resolve: {
		extensions: [".js", ".ts"],
		alias: {
			"$lib": join(process.cwd(), "extension/lib")
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
	}
}
