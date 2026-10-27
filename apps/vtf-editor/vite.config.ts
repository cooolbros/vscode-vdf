import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [
		svelte({
			compilerOptions: {
				experimental: {
					async: true
				}
			}
		})
	],
	base: "",
	build: {
		target: "esnext"
	}
})
