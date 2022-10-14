import { basename, relative, sep } from "path"
import { TextEditor, window } from "vscode"
import { getHUDRoot } from "../../../shared/tools"
import { getVDFDocumentSymbols } from "../../../shared/VDF/dist/getVDFDocumentSymbols"

export function copyKeyValuePath(editor: TextEditor): void {

	const languageId = editor.document.languageId
	if (languageId != "vdf" && languageId != "popfile") {
		return
	}

	const filePath = (() => {
		const fsPath = editor.document.uri.fsPath
		const hudRoot = getHUDRoot({ uri: editor.document.uri.toString() })
		if (hudRoot) {
			return relative(hudRoot, fsPath)
		}
		return basename(fsPath)
	})()

	const position = editor.selection.start

	const documentSymbolResult = (() => {
		const documentSymbols = getVDFDocumentSymbols(editor.document.getText())
		return documentSymbols.getDocumentSymbolAtPosition(position)
	})()

	if (documentSymbolResult) {
		const documentSymbolsPath = [
			...documentSymbolResult.path.map(documentSymbol => documentSymbol.key),
			documentSymbolResult.result.key,
			...(documentSymbolResult.result.detailRange?.contains(position) ? [
				documentSymbolResult.result.detail!
			] : [])
		].map(i => /\s/.test(i) ? `"${i}"` : i)
		const result = `${filePath.split(sep).join("/")} ${documentSymbolsPath.join(" > ")}`

		window.showInputBox({ value: result })
	}
	else {
		window.showErrorMessage("No result.")
	}
}
