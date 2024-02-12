import { VSCodeLanguageClientFileSystem } from "lib/client/VSCodeLanguageClientFileSystem"
import { getHUDRoot } from "lib/utils/getHUDRoot"
import { getVDFDocumentSymbols } from "lib/VDFDocumentSymbols/getVDFDocumentSymbols"
import type { VDFDocumentSymbol } from "lib/VDFDocumentSymbols/VDFDocumentSymbol"
import type { VDFDocumentSymbols } from "lib/VDFDocumentSymbols/VDFDocumentSymbols"
import { basename, relative, sep } from "path"
import { env, Position, TextEditor, Uri, window } from "vscode"

export async function copyKeyValuePath(editor: TextEditor): Promise<void> {

	const languageId = editor.document.languageId
	if (languageId != "vdf" && languageId != "popfile") {
		return
	}

	const filePath = await (async (): Promise<string> => {
		const fsPath = editor.document.uri.fsPath
		const hudRoot = await getHUDRoot({ uri: editor.document.uri.toString() }, new VSCodeLanguageClientFileSystem())
		if (hudRoot) {
			return relative(Uri.parse(hudRoot).fsPath, fsPath)
		}
		return basename(fsPath)
	})()

	function findDocumentSymbolPath(documentSymbols: VDFDocumentSymbols, position: Position): VDFDocumentSymbol[] | null {

		const objectPath: VDFDocumentSymbol[] = []

		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): VDFDocumentSymbol[] | null => {
			for (const documentSymbol of documentSymbols) {

				objectPath.push(documentSymbol)

				if (documentSymbol.children) {

					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result) {
						return result
					}
				}

				if (documentSymbol.range.contains(position)) {
					return objectPath
				}

				objectPath.pop()
			}

			return null
		}

		return iterateDocumentSymbols(documentSymbols.find((documentSymbol) => documentSymbol.key != "#base")?.children ?? documentSymbols)
	}

	const documentSymbolResult = findDocumentSymbolPath(
		getVDFDocumentSymbols(editor.document.getText(), { allowMultilineStrings: false }),
		editor.selection.start
	)

	if (documentSymbolResult) {

		const documentSymbolsPath = [
			...documentSymbolResult.map(documentSymbol => documentSymbol.key),
			...(documentSymbolResult.at(-1)?.detailRange?.contains(editor.selection.start) ? [
				documentSymbolResult.at(-1)!.detail!
			] : [])
		].map(i => /\s/.test(i) ? `"${i}"` : i)

		const result = `${filePath.split(sep).join("/")} ${documentSymbolsPath.join(" > ")}`

		await env.clipboard.writeText(result)
		window.showInputBox({ value: result })
	}
	else {
		window.showErrorMessage("No result.")
	}
}
