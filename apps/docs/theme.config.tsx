import type { DocsThemeConfig } from "nextra-theme-docs"

export default {
	head: (
		<>
			<link rel="shortcut icon" type="image/png" href="https://raw.githubusercontent.com/cooolbros/vscode-vdf/main/icon.png" />
		</>
	),
	docsRepositoryBase: "https://github.com/cooolbros/vscode-vdf/tree/main/apps/docs",
	footer: {
		text: (
			<div>
				<div className="text-black dark:text-white mb-4">Links</div>
				<ul className="grid gap-1">
					<li>
						<a href="https://github.com/cooolbros/vscode-vdf" target="_blank">Github</a>
					</li>
					<li>
						<a href="https://marketplace.visualstudio.com/items?itemName=pfwobcke.vscode-vdf" target="_blank">Visual Studio Marketplace</a>
					</li>
					<li>
						<a href="https://open-vsx.org/extension/pfwobcke/vscode-vdf" target="_blank">Open VSX Registry</a>
					</li>
				</ul>
			</div>
		)
	},
	logo: (
		<div className="flex gap-4 items-center">
			<img src="https://raw.githubusercontent.com/cooolbros/vscode-vdf/main/icon.png" alt="Logo" width={24} height={24} />
			<h1 className="text-lg font-bold">VSCode VDF</h1>
		</div>
	),
	project: {
		link: "https://github.com/cooolbros/vscode-vdf"
	},
	sidebar: {
		toggleButton: true
	},
} satisfies DocsThemeConfig
