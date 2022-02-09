import { Range, TextEditor, TextEditorEdit } from "vscode";
import { VDF } from "../../../shared/VDF";
import { VDFIndentation } from "../../../shared/VDF/dist/models/VDFIndentation";

export function formatVDF(editor: TextEditor, edit: TextEditorEdit): void {
	const { document } = editor
	const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
	if (!editor.selection.isEmpty) {
		edit.replace(editor.selection, VDF.stringify(VDF.parse(document.getText(editor.selection)), { indentation }))
	}
	else {
		edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(VDF.parse(document.getText()), { indentation }))
	}
}
