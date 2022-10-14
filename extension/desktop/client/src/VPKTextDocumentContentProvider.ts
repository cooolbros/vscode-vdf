import { readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { URLSearchParams } from "url"
import * as vscode from "vscode"
import { CancellationToken, TextDocumentContentProvider, Uri } from "vscode"
import { VPK } from "../../shared/tools/dist/VPK"

// https://code.visualstudio.com/api/extension-guides/virtual-documents
export class VPKTextDocumentContentProvider implements TextDocumentContentProvider {

	private readonly workspace: typeof vscode.workspace
	private readonly VPK: VPK

	constructor(workspace: typeof vscode.workspace) {
		this.workspace = workspace
		this.VPK = new VPK(() => this.getTeamFortress2Folder())
	}

	private getTeamFortress2Folder(): string {
		return this.workspace.getConfiguration("vscode-vdf").get("teamFortress2Folder")!
	}

	public async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | undefined> {
		const filePath = uri.fsPath.substring(1)
		const params = new URLSearchParams(uri.query)
		const vpkFile = params.get("vpk")
		if (vpkFile == null) {
			throw new Error(`Uri "${uri.toString()}" is missing parameter "vpk"`)
		}
		// If a VPK file has recently been extracted by a definition provider, read and return the contents
		const readFromTempDir = params.get("readfromTempDir")
		if (readFromTempDir == "true") {
			return readFileSync(join(tmpdir(), filePath), "utf-8")
		}
		const resultPath = await this.VPK.extract(vpkFile, filePath)
		if (resultPath != null) {
			return readFileSync(resultPath, "utf-8")
		}
	}
}
