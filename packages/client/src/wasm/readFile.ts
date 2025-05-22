import { Uri } from "common/Uri"
import { env, UIKind, workspace, type ExtensionContext } from "vscode"

export async function readFile(context: ExtensionContext, url: string) {
	const uri = new Uri(`${new Uri(context.extensionUri).joinPath(`apps/extension/${env.uiKind == UIKind.Desktop ? "desktop" : "browser"}/client/dist`)}/${url.split("/").pop()!}`).with({ query: null })
	return await workspace.fs.readFile(uri)
}
