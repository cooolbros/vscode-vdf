import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig(async (env, argv) => ({
	entry: {
		extension: [
			import.meta.resolve("zod/compile"),
			import.meta.resolve("common/stackTraceLimit"),
			import.meta.resolve("common/getOrInsert"),
			"./src/extension.ts"
		]
	},
	output: {
		clean: true,
		library: {
			type: "commonjs"
		}
	},
	target: "webworker",
	mode: "production",
	externals: ["vscode"],
	devtool: "source-map",
	resolve: {
		alias: {
			// @ts-ignore
			"path": (await import("node:url")).fileURLToPath(import.meta.resolve("path-browserify"))
		},
		extensions: [".js", ".json", ".wasm", ".ts"]
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
			},
			{
				resourceQuery: /url/,
				type: "asset/resource",
			}
		]
	},
	performance: {
		hints: false
	}
}))
