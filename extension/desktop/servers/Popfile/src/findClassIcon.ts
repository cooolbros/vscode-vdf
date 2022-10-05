import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { pathToFileURL, URL } from "url"
import { VPK } from "../../../shared/tools/dist/VPK"

/**
 * Find the VMT for a ClassIcon in a popfile
 * @param classIcon ClassIcon
 */
export async function findClassIcon(teamFortress2Folder: string, classIcon: string): Promise<URL | null> {

	const relativePath = `materials/hud/leaderboard_class_${classIcon}.vmt`

	// Search tf folder
	const path1 = join(teamFortress2Folder, "tf", relativePath)
	if (existsSync(path1)) {
		return pathToFileURL(path1)
	}

	// Search tf/download folder
	const path2 = join(teamFortress2Folder, "tf/download", relativePath)
	if (existsSync(path2)) {
		return pathToFileURL(path2)
	}

	// Search custom folder
	for (const folder of readdirSync(join(teamFortress2Folder, "tf/custom"))) {
		const pathI = join(teamFortress2Folder, "tf/custom", folder, relativePath)
		if (existsSync(pathI)) {
			return pathToFileURL(pathI)
		}
	}

	// Search tf2_misc_dir.vpk
	const vpk = new VPK(teamFortress2Folder)
	const tf2_misc_dir = "tf/tf2_misc_dir.vpk"
	const vpkResult = await vpk.extract(tf2_misc_dir, relativePath)
	if (vpkResult != null) {
		return new URL(`vpk:///${relativePath}?vpk=${tf2_misc_dir}&readfromTempDir=true`)
	}

	return null
}
