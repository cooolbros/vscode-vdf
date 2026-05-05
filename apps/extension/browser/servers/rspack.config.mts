import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { readdirSync } from "fs"
import { posix } from "path"
import { fileURLToPath } from "url"

export default defineConfig({
	entry: Object.fromEntries(readdirSync("src").map((name) => [posix.parse(name).name, [import.meta.resolve("common/stackTraceLimit"), `./src/${name}`]])),
	output: {
		clean: true,
		library: {
			name: "serverExportVar",
			type: "var",
		}
	},
	target: "webworker",
	mode: "production",
	devtool: "source-map",
	resolve: {
		alias: {
			"path": fileURLToPath(import.meta.resolve("path-browserify"))
		},
		extensions: [".js", ".ts"]
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				use: {
					loader: "builtin:swc-loader",
					options: {
						jsc: {
							target: "esnext",
						}
					} as SwcLoaderOptions
				}
			}
		]
	},
	performance: {
		hints: false
	}
})
