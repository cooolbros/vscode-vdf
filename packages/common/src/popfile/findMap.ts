import { posix } from "path"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { Uri } from "../Uri"

export async function findMap(uri: Uri, fileSystem: FileSystemMountPoint): Promise<`mvm_${string}.bsp` | null> {
	const maps = await fileSystem.readDirectory("maps", { pattern: "mvm_*.bsp" })
	const basename = uri.basename()

	const bsps = maps
		.values()
		.filter(([, type]) => type == 1)
		.map(([name]) => posix.parse(name).name)
		.filter((name) => basename.startsWith(name))
		.toArray()
		.toSorted((a, b) => basename.substring(a.length).length - basename.substring(b.length).length)

	const bsp = bsps.at(0)
	console.log(`${basename} => ${bsp != undefined ? `${bsp}.bsp` : null}`)
	if (!bsp) {
		return null
	}
	return `${bsp as `mvm_${string}`}.bsp`
}
