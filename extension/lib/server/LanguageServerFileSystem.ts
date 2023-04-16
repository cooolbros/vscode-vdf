import type { VSCodeVDFFileSystem } from "$lib/types/VSCodeVDFFileSystem"
import type { FileStat, FileType } from "vscode"
import type { Connection } from "vscode-languageserver"

export class LanguageServerFileSystem implements VSCodeVDFFileSystem {

	private readonly connection: Connection

	constructor(connection: Connection) {
		this.connection = connection
	}

	public async exists(uri: string): Promise<boolean> {
		return this.connection.sendRequest("vscode-vdf/fs/exists", uri)
	}

	public async stat(uri: string): Promise<FileStat> {
		return this.connection.sendRequest("vscode-vdf/fs/stat", uri)
	}

	public async readFile(uri: string): Promise<string> {
		return this.connection.sendRequest("vscode-vdf/fs/readFile", uri)
	}

	public async readFileBinary(uri: string): Promise<Uint8Array> {
		return this.connection.sendRequest("vscode-vdf/fs/readFileBinary", uri)
	}

	public async readDirectory(uri: string): Promise<[string, FileType][]> {
		return this.connection.sendRequest("vscode-vdf/fs/readDirectory", uri)
	}
}
