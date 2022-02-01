import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { VPKExtract } from "../../../shared/tools"

/**
 * Find the VMT for a ClassIcon in a popfile
 * @param classIcon ClassIcon
 */
export function findClassIcon(teamFortress2Folder: string, classIcon: string): string | null {
	const relativePath = `materials/hud/leaderboard_class_${classIcon}.vmt`

	// Search tf folder
	const path1 = join(teamFortress2Folder, `tf`, relativePath)
	if (existsSync(path1)) {
		return path1
	}

	// Search tf/download folder
	const path2 = join(teamFortress2Folder, "tf/download", relativePath)
	if (existsSync(path2)) {
		return path2
	}

	// Search custom folder
	for (const folder of readdirSync(join(teamFortress2Folder, "tf/custom"))) {
		const pathI = join(teamFortress2Folder, "tf/custom", folder, relativePath)
		if (existsSync(pathI)) {
			return pathI
		}
	}

	// Search tf2_misc_dir.vpk
	const vpkResult = VPKExtract(teamFortress2Folder, "tf/tf2_misc_dir.vpk", relativePath)
	if (vpkResult != null) {
		return vpkResult
	}

	return null
}
