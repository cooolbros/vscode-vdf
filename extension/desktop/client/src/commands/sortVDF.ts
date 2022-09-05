import { EndOfLine, Range, TextEditor, TextEditorEdit } from "vscode";
import { VDFIndentation } from "../../../shared/VDF/dist/models/VDFIndentation";
import { VDFNewLine } from "../../../shared/VDF/dist/models/VDFNewLine";
import { VDF } from "../../../shared/VDF/dist/VDF";
import * as sortKeysOrders from "../JSON/vdf_sort_keys_orders.json";

export function sortVDF(editor: TextEditor, edit: TextEditorEdit): void {
	const { document } = editor
	const ext = document.fileName.split('.').pop()
	if (ext && ((ext): ext is keyof typeof sortKeysOrders => sortKeysOrders.hasOwnProperty(ext))(ext)) {
		const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
		const newLine = document.eol == EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF
		const order = sortKeysOrders[ext]
		const result: string = VDF.stringify(VDF.parse(document.getText()), { indentation, newLine, order })
		edit.replace(new Range(0, 0, document.lineCount, 0), result)
	}
}
