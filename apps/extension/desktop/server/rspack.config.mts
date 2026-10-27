import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig((env, argv) => ({
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
