import { FileType, Uri, workspace, type FileStat } from "vscode"
import type { VSCodeVDFFileSystem } from "../types/VSCodeVDFFileSystem"

export class VSCodeLanguageClientFileSystem implements VSCodeVDFFileSystem {

	private readonly UTF8Decoder = new TextDecoder("utf-8")
	private readonly UTF16LEDecoder = new TextDecoder("utf-16le")

	public async exists(uri: string): Promise<boolean> {
		try {
			await workspace.fs.stat(Uri.parse(uri))
			return true
		}
		catch (error: any) {
			return false
		}
	}

	public async stat(uri: string): Promise<FileStat> {
		return workspace.fs.stat(Uri.parse(uri))
	}

	public async readFile(uri: string): Promise<string> {
		const arr = await workspace.fs.readFile(Uri.parse(uri))
		if (arr[0] == 255 && arr[1] == 254) {
			return this.UTF16LEDecoder.decode(arr)
		}
		return this.UTF8Decoder.decode(arr)
	}

	public async readFileBinary(uri: string, begin?: number, end?: number): Promise<Uint8Array> {
		return (await workspace.fs.readFile(Uri.parse(uri))).subarray(begin, end)
	}

	public async readDirectory(uri: string): Promise<[string, FileType][]> {
		return workspace.fs.readDirectory(Uri.parse(uri))
	}
}
