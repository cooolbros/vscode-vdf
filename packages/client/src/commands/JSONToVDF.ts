import { VDF, VDFIndentation, VDFNewLine, type VDFStringifyOptions } from "vdf"
import vscode from "vscode"

export function JSONToVDF(editor: vscode.TextEditor, edit: vscode.TextEditorEdit): void {

	const { document } = editor

	const options: VDFStringifyOptions = {
		indentation: editor.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
		newLine: document.eol == vscode.EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF,
		tabSize: typeof editor.options.tabSize == "number" ? editor.options.tabSize : 4,
	}

	if (!editor.selection.isEmpty) {
		edit.replace(editor.selection, VDF.stringify(JSON.parse(document.getText(editor.selection)), options))
	}
	else {
		edit.replace(new vscode.Range(0, 0, document.lineCount, 0), VDF.stringify(JSON.parse(document.getText()), options))
		vscode.languages.setTextDocumentLanguage(document, "vdf")
	}
}
