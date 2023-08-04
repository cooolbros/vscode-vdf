import type { VSCodeVDFFileSystem } from "lib/types/VSCodeVDFFileSystem"
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

	public async readFileBinary(uri: string, begin?: number, end?: number): Promise<Uint8Array> {
		const response: ReturnType<Buffer["toJSON"]> | Uint8Array = await this.connection.sendRequest("vscode-vdf/fs/readFileBinary", { uri, begin, end })
		if ("type" in response) {
			return new Uint8Array(response.data)
		}
		return response
	}

	public async readDirectory(uri: string): Promise<[string, FileType][]> {
		return this.connection.sendRequest("vscode-vdf/fs/readDirectory", uri)
	}
}
