import { VDF } from "vdf"
import { languages, Range, type TextEditor, type TextEditorEdit } from "vscode"

export function VDFToJSON(editor: TextEditor, edit: TextEditorEdit): void {
	const { document } = editor
	const indentation = !editor.options.insertSpaces ? "\t" : "    "
	if (!editor.selection.isEmpty) {
		edit.replace(editor.selection, JSON.stringify(VDF.parse(document.getText(editor.selection)), null, indentation))
	}
	else {
		edit.replace(new Range(0, 0, document.lineCount, 0), JSON.stringify(VDF.parse(document.getText()), null, indentation))
		languages.setTextDocumentLanguage(document, "json")
	}
}
