import type { Metadata } from "next"
import { Footer, Layout, Navbar } from "nextra-theme-docs"
import "nextra-theme-docs/style-prefixed.css"
import { Banner, Head } from "nextra/components"
import { getPageMap } from "nextra/page-map"
import type { ReactNode } from "react"
import "./globals.css"

// https://nextjs.org/docs/app/building-your-application/optimizing/metadata
export const metadata: Metadata = {
	title: {
		default: "VSCode VDF",
		template: "%s - VSCode VDF"
	}
}

const logo = (
	<div className="flex gap-4 items-center">
		<img src="https://raw.githubusercontent.com/cooolbros/vscode-vdf/main/icon.png" alt="Logo" width={24} height={24} />
		<h1 className="text-lg font-medium">VSCode VDF</h1>
	</div>
)

const navbar = (
	<Navbar
		logo={logo}
		projectLink="https://github.com/cooolbros/vscode-vdf"
	/>
)

const banner = (
	<Banner>🚧 WIP</Banner>
)

const footer = (
	<Footer>
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
	</Footer>
)

export default async function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" dir="ltr" suppressHydrationWarning>
			<Head>
				<link rel="shortcut icon" type="image/png" href="https://raw.githubusercontent.com/cooolbros/vscode-vdf/main/icon.png" />
			</Head>
			<body>
				<Layout
					footer={footer}
					navbar={navbar}
					pageMap={await getPageMap()}
					banner={banner}
					docsRepositoryBase="https://github.com/cooolbros/vscode-vdf/tree/main/apps/docs"
					editLink="Edit this page"
				>
					{children}
				</Layout>
			</body>
		</html>
	)
}
