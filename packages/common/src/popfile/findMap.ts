import { posix } from "path"
import { distinctUntilChanged, map, type Observable } from "rxjs"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { Uri } from "../Uri"

export function findMap(uri: Uri, fileSystem: FileSystemMountPoint): Observable<`mvm_${string}.bsp` | null> {
	const extname = posix.extname(uri.basename())
	if (extname != ".pop") {
		throw new Error(extname)
	}

	const basename = uri.basename()

	return fileSystem.watchDirectory("maps", { pattern: "mvm_*.bsp" }).pipe(
		map((maps) => {
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

			return <const>`${bsp as `mvm_${string}`}.bsp`
		}),
		distinctUntilChanged(),
	)
}
