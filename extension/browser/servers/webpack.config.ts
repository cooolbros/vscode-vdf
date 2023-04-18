import { readdirSync } from "fs"
import { join } from "path"
import type { Configuration } from "webpack"

export const browserServersConfiguration: Configuration = {
	mode: "production",
	target: "webworker",
	entry: Object.fromEntries(
		readdirSync(__dirname, { withFileTypes: true })
			.filter(i => i.isDirectory())
			.map((server) => [`${server.name.toLowerCase()}`, join(__dirname, `${server.name}/src/server.ts`)])
	),
	output: {
		path: join(process.cwd(), "dist/browser/servers"),
		libraryTarget: "var",
		library: "serverExportVar",
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
