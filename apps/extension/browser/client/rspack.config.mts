import { defineConfig } from "@rspack/cli"
import type { SwcLoaderOptions } from "@rspack/core"
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin"
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
