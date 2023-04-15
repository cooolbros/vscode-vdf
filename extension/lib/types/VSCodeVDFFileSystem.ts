import type { FileStat, FileType } from "vscode"

export interface VSCodeVDFFileSystem {
	exists(uri: string): Promise<boolean>
	stat(uri: string): Promise<FileStat>
	readFile(uri: string): Promise<string>
	readFileBinary(uri: string): Promise<Uint8Array>
	readDirectory(uri: string): Promise<[string, FileType][]>
}
