import { EndOfLine, languages, Range, type TextEditor, type TextEditorEdit } from "vscode"
import { VDF } from "../VDF/VDF"
import { VDFIndentation } from "../VDF/VDFIndentation"
import { VDFNewLine } from "../VDF/VDFNewLine"
import type { VDFStringifyOptions } from "../VDF/VDFStringifyOptions"


export function JSONToVDF(editor: TextEditor, edit: TextEditorEdit): void {

	const { document } = editor

	const options: VDFStringifyOptions = {
		indentation: editor.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
		newLine: document.eol == EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF,
		tabSize: typeof editor.options.tabSize == "number" ? editor.options.tabSize : 4,
	}

	if (!editor.selection.isEmpty) {
		edit.replace(editor.selection, VDF.stringify(JSON.parse(document.getText(editor.selection)), options))
	}
	else {
		edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(JSON.parse(document.getText()), options))
		languages.setTextDocumentLanguage(document, "vdf")
	}
}
