import { EndOfLine, languages, Range, TextEditor, TextEditorEdit } from "vscode"
import { VDFIndentation } from "../../../shared/VDF/dist/models/VDFIndentation"
import { VDFNewLine } from "../../../shared/VDF/dist/models/VDFNewLine"
import { VDF } from "../../../shared/VDF/dist/VDF"

export function JSONToVDF(editor: TextEditor, edit: TextEditorEdit): void {
	const { document } = editor
	const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
	const newLine = document.eol == EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF
	if (!editor.selection.isEmpty) {
		edit.replace(editor.selection, VDF.stringify(JSON.parse(document.getText(editor.selection)), { indentation, newLine }))
	}
	else {
		edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(JSON.parse(document.getText()), { indentation, newLine }))
		languages.setTextDocumentLanguage(document, "vdf")
	}
}
