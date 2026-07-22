import { join } from "path"
import vscode from "vscode"

export async function extractVPKFileToWorkspace(editor: vscode.TextEditor): Promise<void> {

	const currentWorkspace = vscode.workspace.workspaceFolders
		? vscode.workspace.workspaceFolders.length > 1
			? await (async (): Promise<vscode.WorkspaceFolder> => {
				const selection = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders!.map(workspaceFolder => workspaceFolder.name), { title: "Select workspace folder to extract VPK file to" })
				return vscode.workspace.workspaceFolders!.find(workspaceFolder => workspaceFolder.name == selection)!
			})()
			: vscode.workspace.workspaceFolders[0]
		: null

	if (!currentWorkspace) {
		vscode.window.showErrorMessage("No workspace folder.")
		return
	}

	const source = editor.document.uri
	const target = vscode.Uri.file(join(currentWorkspace.uri.fsPath, source.fsPath))

	await vscode.workspace.fs.copy(source, target)

	vscode.window.showTextDocument(target)
}
