import { readdirSync } from "fs"
import { join } from "path"
import type { Configuration } from "webpack"

export const desktopServersConfiguration: Configuration = {
	mode: "production",
	target: "node",
	entry: Object.fromEntries(readdirSync(__dirname, { withFileTypes: true }).filter(i => i.isDirectory()).map((server) => [`${server.name.toLowerCase()}`, join(__dirname, `${server.name}/src/server.ts`)])),
	output: {
		path: join(process.cwd(), "dist/desktop/servers"),
		libraryTarget: "commonjs2"
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
