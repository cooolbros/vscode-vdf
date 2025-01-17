import nextra from "nextra"
import { createHighlighter } from "shiki"

const withNextra = nextra({
	defaultShowCopyCode: true,
	mdxOptions: {
		rehypePrettyCodeOptions: {
			theme: {
				light: "light-plus",
				dark: "dark-plus",
			},
			getHighlighter: async (options) => {
				return await createHighlighter({
					...options,
					themes: ["light-plus", "dark-plus"],
					langs: [
						// @ts-ignore
						async () => await import("../syntaxes/dist/hudanimations.tmLanguage.json", { with: { type: "json" } }),
						async () => await import("../syntaxes/dist/vdf.tmLanguage.json", { with: { type: "json" } }),
					]
				})
			}
		}
	}
})

export default withNextra({
	distDir: "dist",
	images: {
		unoptimized: true
	},
	basePath: "/vscode-vdf",
	output: "export",
})
