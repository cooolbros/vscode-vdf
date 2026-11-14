import { defineConfig } from "oxlint"
import { config } from "oxlint-config"

export default defineConfig({
	extends: [config],
	ignorePatterns: [
		"apps/API/seed.ts",
		"**/rspack.config.mts"
	]
})
