import vscode from "vscode"

export async function selectTeamFortress2Folder() {
	const result = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
	})

	if (result && result.length) {
		const uri = result[0]

		const exists = await vscode.workspace.fs.stat(vscode.Uri.joinPath(uri, "tf/gameinfo.txt")).then((stat) => stat.type == vscode.FileType.File, () => false)
		if (!exists) {
			vscode.window.showErrorMessage(`Invalid Team Fortress 2 folder: "${uri.fsPath}"`)
			return
		}

		const path = uri.fsPath.replaceAll("\\", "/")
		vscode.workspace.getConfiguration("vscode-vdf").update("teamFortress2Folder", path, true)

		// Open settings UI to unfocus "Select Folder" link and refresh UI
		vscode.commands.executeCommand("workbench.action.openSettings2")
	}
}
