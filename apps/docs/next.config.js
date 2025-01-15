import nextra from "nextra"

const withNextra = nextra({
	theme: "nextra-theme-docs",
	themeConfig: "./theme.config.tsx",
	defaultShowCopyCode: true,
})

export default withNextra({
	distDir: "dist",
	images: {
		unoptimized: true
	},
	basePath: "/vscode-vdf",
	output: "export",
})
