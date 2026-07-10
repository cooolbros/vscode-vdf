import { Uri } from "common/Uri"
import { FileType, workspace } from "vscode"

/**
 * Resolve root folder of an absolute workspace file uri
 * @param uri File uri
 * @returns The root of the workspace folder as a file uri (`file:///C:/...`) or null if the workspace root directory is not found
 */
export async function searchForWorkspaceRoot(uri: Uri) {
	let folderUri = uri.dirname()
	let folderUriReference = uri

	while (!Uri.equals(folderUri, folderUriReference)) {
		const info = workspace.fs.stat(folderUri.joinPath("info.vdf")).then((stat) => stat.type == FileType.File, () => false)
		const gameinfo = workspace.fs.stat(folderUri.joinPath("gameinfo.txt")).then((stat) => stat.type == FileType.File, () => false)

		if ((await Promise.all([info, gameinfo])).some((exists) => exists)) {
			return folderUri
		}

		folderUri = folderUri.dirname()
		folderUriReference = folderUriReference.dirname()
	}

	return null
}
