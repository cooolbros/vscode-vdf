import { Uri } from "common/Uri"
import { workspace } from "vscode"

export async function setVTFFlags(components: ConstructorParameters<typeof Uri>[0], flags: number) {
	const uri = new Uri(components)
	const buf = await workspace.fs.readFile(uri)
	const dataView = new DataView(buf.buffer)
	dataView.setUint32(20, dataView.getUint32(20, true) | flags, true)
	await workspace.fs.writeFile(uri, buf)
}
