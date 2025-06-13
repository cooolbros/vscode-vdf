import { Uri } from "common/Uri"
import { posix } from "path"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { Position, env, window, type TextEditor } from "vscode"
import { searchForHUDRoot } from "../searchForHUDRoot"

export async function copyKeyValuePath(editor: TextEditor): Promise<void> {

	const languageId = editor.document.languageId
	if (languageId != "vdf" && languageId != "popfile") {
		return
	}

	const filePath = await (async (): Promise<string> => {
		const fsPath = editor.document.uri.fsPath
		const hudRoot = await searchForHUDRoot(new Uri(editor.document.uri))
		if (hudRoot) {
			return posix.relative(hudRoot.fsPath, fsPath)
		}
		return posix.basename(fsPath)
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
		getVDFDocumentSymbols(editor.document.getText(), { multilineStrings: false }),
		editor.selection.start
	)

	if (documentSymbolResult) {

		const documentSymbolsPath = [
			...documentSymbolResult.map(documentSymbol => documentSymbol.key),
			...(documentSymbolResult.at(-1)?.detailRange?.contains(editor.selection.start) ? [
				documentSymbolResult.at(-1)!.detail!
			] : [])
		].map(i => /\s/.test(i) ? `"${i}"` : i)

		const result = `${filePath.split(/[/\\]+/).join("/")} ${documentSymbolsPath.join(" > ")}`

		await env.clipboard.writeText(result)
		window.showInputBox({ value: result })
	}
	else {
		window.showErrorMessage("No result.")
	}
}
