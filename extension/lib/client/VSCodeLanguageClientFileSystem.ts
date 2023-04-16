import type { VSCodeVDFFileSystem } from "$lib/types/VSCodeVDFFileSystem"
import { FileStat, FileType, Uri, workspace } from "vscode"

export class VSCodeLanguageClientFileSystem implements VSCodeVDFFileSystem {

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
			return Buffer.from(arr).toString("utf16le")
		}
		return arr.toString()
	}

	public async readFileBinary(uri: string): Promise<Uint8Array> {
		return workspace.fs.readFile(Uri.parse(uri))
	}

	public async readDirectory(uri: string): Promise<[string, FileType][]> {
		return workspace.fs.readDirectory(Uri.parse(uri))
	}
}
