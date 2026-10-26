import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"
import { fileURLToPath } from "url"

export default defineConfig({
	entry: {
		server: [
			import.meta.resolve("zod/compile"),
			import.meta.resolve("common/stackTraceLimit"),
			import.meta.resolve("common/getOrInsert"),
			"./src/server.ts"
		]
	},
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
