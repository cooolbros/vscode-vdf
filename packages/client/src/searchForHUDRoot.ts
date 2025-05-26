import type { Uri } from "common/Uri"
import { FileType, workspace } from "vscode"

/**
 * Resolve root folder of an absolute HUD file uri
 * @param uri File uri
 * @returns The root of the HUD folder as a file uri (`file:///C:/...`) or null if the HUD root directory is not found
 */
export async function searchForHUDRoot(uri: Uri) {
	let folderUri = uri.dirname()
	let folderUriReference = uri

	while (!folderUri.equals(folderUriReference)) {
		if (await workspace.fs.stat(folderUri.joinPath("info.vdf")).then((stat) => stat.type == FileType.File, () => false)) {
			return folderUri
		}

		folderUri = folderUri.dirname()
		folderUriReference = folderUriReference.dirname()
	}

	return null
}
