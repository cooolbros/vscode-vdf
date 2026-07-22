import { Uri } from "common/Uri"
import vscode from "vscode"

export async function readFile(context: vscode.ExtensionContext, url: string) {
	const uri = new Uri(`${new Uri(context.extensionUri).joinPath(`apps/extension/${vscode.env.uiKind == vscode.UIKind.Desktop ? "desktop" : "browser"}/client/dist`)}/${url.split("/").pop()!}`).with({ query: null })
	return await vscode.workspace.fs.readFile(uri)
}
