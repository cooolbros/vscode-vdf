import { Uri } from "common/Uri"
import vscode from "vscode"

/**
 * Resolve root folder of an absolute HUD file uri
 * @param uri File uri
 * @returns The root of the HUD folder as a file uri (`file:///C:/...`) or null if the HUD root directory is not found
 */
export async function searchForHUDRoot(uri: Uri) {
	let folderUri = uri.dirname()
	let folderUriReference = uri

	while (!Uri.equals(folderUri, folderUriReference)) {
		if (await vscode.workspace.fs.stat(folderUri.joinPath("info.vdf")).then((stat) => stat.type == vscode.FileType.File, () => false)) {
			return folderUri
		}

		folderUri = folderUri.dirname()
		folderUriReference = folderUriReference.dirname()
	}

	return null
}
