import { Disposable, Position, Range, window, type DecorationInstanceRenderOptions, type DecorationOptions } from "vscode"
import type { BaseLanguageClient } from "vscode-languageclient"

const hudAnimationsEventDecorationType = window.createTextEditorDecorationType({
	after: {
		margin: "0 0 0 0.5rem",
		color: "#99999959",
	}
})

type JSONDecorationOptions = {
	range: JSONRange
	renderOptions?: DecorationInstanceRenderOptions
}

type JSONRange = { start: JSONPosition, end: JSONPosition }
type JSONPosition = { line: number, character: number }

export function initHUDAnimationsLanguageClientDecorations(languageClient: BaseLanguageClient): Disposable {

	const editorDecorationss = new Map<string, DecorationOptions[]>()

	window.onDidChangeActiveTextEditor((editor) => {
		if (!editor) {
			return
		}

		const decorations = editorDecorationss.get(editor.document.uri.toString())
		if (decorations) {
			editor.setDecorations(hudAnimationsEventDecorationType, decorations)
		}
	})

	return languageClient.onRequest("textDocument/decoration", ([uri, decorations]: [string, JSONDecorationOptions[]]) => {

		const editor = window.visibleTextEditors.find((editor) => editor.document.uri.toString() == uri)

		if (!editor) {
			return
		}

		const editorDecorations = decorations.map((decoration) => {
			const range = decoration.range
			return {
				range: new Range(new Position(range.start.line, range.start.character), new Position(range.end.line, range.end.character)),
				renderOptions: decoration.renderOptions
			}
		})

		editorDecorationss.set(editor.document.uri.toString(), editorDecorations)

		editor?.setDecorations(
			hudAnimationsEventDecorationType,
			editorDecorations
		)
	})
}
