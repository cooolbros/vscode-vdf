import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [svelte()],
	base: "",
	resolve: {
		alias: {
			path: "path-browserify"
		}
	},
	build: {
		target: "esnext",
		rolldownOptions: {
			output: {
				assetFileNames: "assets/[name].[ext]"
			}
		}
	}
})
