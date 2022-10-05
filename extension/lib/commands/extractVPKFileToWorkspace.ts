import { copyFileSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import { URLSearchParams } from "url"
import { TextEditor, Uri, window, workspace } from "vscode"
import { VPK } from "../../../shared/tools/dist/VPK"

export async function extractVPKFileToWorkspace(editor: TextEditor): Promise<void> {

	const currentWorkspace = workspace.workspaceFolders
		? workspace.workspaceFolders.length > 1
			? await (async () => {
				const selection = await window.showQuickPick(workspace.workspaceFolders!.map(workspaceFolder => workspaceFolder.name), { title: "Select workspace folder to extract VPK file to" })
				return workspace.workspaceFolders!.find(workspaceFolder => workspaceFolder.name == selection)!
			})()
			: workspace.workspaceFolders[0]
		: null

	if (!currentWorkspace) {
		window.showErrorMessage("Cannot find workspace folder")
		return
	}

	const workspaceFolder = currentWorkspace.uri.fsPath

	const uri = editor.document.uri
	const vpk = new VPK(workspace.getConfiguration("vscode-vdf").get("teamFortress2Folder")!)
	const params = new URLSearchParams(uri.query)

	const result = await vpk.extract(params.get("vpk")!, uri.fsPath)

	mkdirSync(join(workspaceFolder, dirname(uri.fsPath)), { recursive: true })
	copyFileSync(result!, join(workspaceFolder, uri.fsPath))

	window.showTextDocument(Uri.file(join(workspaceFolder, uri.fsPath)))
}
