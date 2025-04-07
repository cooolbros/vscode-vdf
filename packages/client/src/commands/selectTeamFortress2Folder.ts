import { commands, FileType, Uri, window, workspace } from "vscode"

export async function selectTeamFortress2Folder() {
	const result = await window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
	})

	if (result && result.length) {
		const uri = result[0]

		const exists = await workspace.fs.stat(Uri.joinPath(uri, "tf/gameinfo.txt")).then((stat) => stat.type == FileType.File, () => false)
		if (!exists) {
			window.showErrorMessage(`Invalid Team Fortress 2 folder: "${uri.fsPath}"`)
			return
		}

		const path = uri.fsPath.replaceAll("\\", "/")
		workspace.getConfiguration("vscode-vdf").update("teamFortress2Folder", path, true)

		// Open settings UI to unfocus "Select Folder" link and refresh UI
		commands.executeCommand("workbench.action.openSettings2")
	}
}
