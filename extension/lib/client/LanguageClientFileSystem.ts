import type { BaseLanguageClient } from "vscode-languageclient"
import { VSCodeLanguageClientFileSystem } from "./VSCodeLanguageClientFileSystem"

export function initLanguageClientFileSystem(languageClient: BaseLanguageClient): void {

	const fileSystem = new VSCodeLanguageClientFileSystem()

	languageClient.onRequest("vscode-vdf/fs/exists", async (uri: string) => {
		return fileSystem.exists(uri)
	})

	languageClient.onRequest("vscode-vdf/fs/stat", async (uri: string) => {
		return fileSystem.stat(uri)
	})

	languageClient.onRequest("vscode-vdf/fs/readFile", async (uri: string) => {
		return fileSystem.readFile(uri)
	})

	languageClient.onRequest("vscode-vdf/fs/readFileBinary", async (uri: string) => {
		return fileSystem.readFileBinary(uri)
	})

	languageClient.onRequest("vscode-vdf/fs/readDirectory", async (uri: string) => {
		return fileSystem.readDirectory(uri)
	})
}
