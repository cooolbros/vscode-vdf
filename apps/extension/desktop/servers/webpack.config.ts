import { readdirSync } from "fs"
import { posix } from "path"
import type { Configuration } from "webpack"

export default {
	mode: "production",
	target: "node",
	entry: Object.fromEntries(readdirSync("src").map((name) => [posix.parse(name).name, [import.meta.resolve("disposablestack/auto"), posix.join(import.meta.dirname, `src/${name}`)]])),
	output: {
		path: posix.join(import.meta.dirname, "dist"),
		libraryTarget: "commonjs2",
		clean: true,
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
