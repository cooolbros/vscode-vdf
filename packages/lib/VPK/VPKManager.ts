import { Uri, workspace } from "vscode"
import type { VSCodeVDFFileSystem } from "../types/VSCodeVDFFileSystem"
import { VPK } from "./VPK"

export class VPKManager {

	private readonly fileSystem: VSCodeVDFFileSystem
	private readonly vpks: Map<string, VPK>

	constructor(fileSystem: VSCodeVDFFileSystem) {
		this.fileSystem = fileSystem
		this.vpks = new Map<string, VPK>()
	}

	public async get(relativePath: string): Promise<VPK> {

		let vpk = this.vpks.get(relativePath)

		if (!vpk) {
			const uri = Uri.file(`${workspace.getConfiguration("vscode-vdf")["teamFortress2Folder"]}/${relativePath}`).toString()

			const [stat, buf] = await Promise.all([
				this.fileSystem.stat(uri),
				this.fileSystem.readFileBinary(uri)
			])

			vpk = new VPK(uri, stat, buf)

			this.vpks.set(relativePath, vpk)
		}

		return vpk
	}
}
