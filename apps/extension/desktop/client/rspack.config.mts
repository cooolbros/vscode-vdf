import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"

export default defineConfig({
	entry: {
		extension: "./src/extension.ts"
	},
	output: {
		clean: true,
		library: {
			type: "commonjs2"
		}
	},
	target: "node",
	mode: "production",
	externals: ["vscode"],
	devtool: "source-map",
	resolve: {
		extensions: [".js", ".json", ".wasm", ".ts"]
	},
	plugins: [
		new TsCheckerRspackPlugin()
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
})
