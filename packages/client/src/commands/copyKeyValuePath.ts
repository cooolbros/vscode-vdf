import { Uri } from "common/Uri"
import { posix } from "path"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { quote } from "vdf-format"
import vscode from "vscode"
import { searchForWorkspaceRoot } from "../searchForWorkspaceRoot"

export async function copyKeyValuePath(editor: vscode.TextEditor): Promise<void> {

	if (!new Set(["popfile", "vdf", "vmt"]).has(editor.document.languageId)) {
		return
	}

	const filePath = await (async (): Promise<string> => {
		const uri = new Uri(editor.document.uri)

		const fsPath = uri.fsPath
		const workspaceRoot = await searchForWorkspaceRoot(uri)

		return workspaceRoot != null
			? posix.relative(workspaceRoot.fsPath, fsPath)
			: posix.basename(fsPath)
	})()

	const documentSymbols = getVDFDocumentSymbols(editor.document.getText(), { multilineStrings: false })
	const documentSymbolResult = documentSymbols.findRecursive((documentSymbol) => documentSymbol.range.contains(editor.selection.start))
	if (!documentSymbolResult) {
		vscode.window.showErrorMessage("No result.")
		return
	}

	const path = [...documentSymbolResult.path, documentSymbolResult.documentSymbol]

	const documentSymbolsPath = [
		...path.map((documentSymbol) => documentSymbol.key),
		...(path.at(-1)?.detailRange?.contains(editor.selection.start) ? [path.at(-1)!.detail!] : [])
	].map((value) => quote(value) ? `"${value}"` : value)

	const result = `${filePath.split(/[/\\]+/).join("/")} ${documentSymbolsPath.join(" > ")}`

	await vscode.env.clipboard.writeText(result)
	vscode.window.showInputBox({ value: result })
}
