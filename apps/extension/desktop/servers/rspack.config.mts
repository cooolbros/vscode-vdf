import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { readdirSync } from "fs"
import { posix } from "path"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig({
	entry: Object.fromEntries(readdirSync("src").map((name) => [posix.parse(name).name, [import.meta.resolve("common/stackTraceLimit"), `./src/${name}`]])),
	output: {
		clean: true,
		library: {
			type: "commonjs2",
		}
	},
	target: "node",
	mode: "production",
	devtool: "source-map",
	resolve: {
		extensions: [".js", ".ts"]
	},
	plugins: [
		process.env["npm_lifecycle_event"] == "build" ? new TsCheckerRspackPlugin() : null
	],
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
