import { join } from "path"
import vscode, { window, workspace, type TextEditor, type WorkspaceFolder } from "vscode"

export async function extractVPKFileToWorkspace(editor: TextEditor): Promise<void> {

	const currentWorkspace = workspace.workspaceFolders
		? workspace.workspaceFolders.length > 1
			? await (async (): Promise<WorkspaceFolder> => {
				const selection = await window.showQuickPick(workspace.workspaceFolders!.map(workspaceFolder => workspaceFolder.name), { title: "Select workspace folder to extract VPK file to" })
				return workspace.workspaceFolders!.find(workspaceFolder => workspaceFolder.name == selection)!
			})()
			: workspace.workspaceFolders[0]
		: null

	if (!currentWorkspace) {
		window.showErrorMessage("No workspace folder.")
		return
	}

	const source = editor.document.uri
	const target = vscode.Uri.file(join(currentWorkspace.uri.fsPath, source.fsPath))

	await workspace.fs.copy(source, target)

	window.showTextDocument(target)
}
