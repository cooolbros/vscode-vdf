import nextra from "nextra"

const withNextra = nextra({
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
