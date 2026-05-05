import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { fileURLToPath } from "url"

export default defineConfig({
	entry: {
		extension: "./src/extension.ts"
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
			"path": fileURLToPath(import.meta.resolve("path-browserify"))
		},
		extensions: [".js", ".json", ".wasm", ".ts"]
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
