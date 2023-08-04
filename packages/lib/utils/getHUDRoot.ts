import type { VSCodeVDFFileSystem } from "lib/types/VSCodeVDFFileSystem"
import { dirname } from "path"

/**
 * Resolve root folder of an absolute HUD file uri
 * @param uri File uri containing object.
 * @returns The root of the HUD folder as a file uri (`file:///C:/...`) or null if the HUD root directory is not found
 */
export async function getHUDRoot({ uri }: { uri: string }, fileSystem: VSCodeVDFFileSystem): Promise<string | null> {

	let folderPath = dirname(uri)
	let folderPathReference = uri

	while (folderPath != folderPathReference) {
		if (await fileSystem.exists(`${folderPath}/info.vdf`)) {
			return folderPath
		}
		folderPath = dirname(folderPath)
		folderPathReference = dirname(folderPathReference)
	}

	return null
}
