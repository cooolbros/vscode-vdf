import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig(async (env, argv) => ({
	entry: {
		server: [
			// import.meta.resolve("zod/compile"),
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
			// @ts-ignore
			"path": (await import("node:url")).fileURLToPath(import.meta.resolve("path-browserify"))
		},
		extensions: [".js", ".ts"]
	},
	plugins: [
		env.RSPACK_BUILD ? new TsCheckerRspackPlugin() : null
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
}))
