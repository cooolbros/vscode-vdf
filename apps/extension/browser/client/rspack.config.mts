import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig((env, argv) => ({
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
			"path": new URL(import.meta.resolve("path-browserify")).pathname.substring(1)
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
