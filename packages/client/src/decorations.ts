import type { DecorationOptions, TextEditor, TextEditorDecorationType } from "vscode"

export const decorationTypes = new Map<string, TextEditorDecorationType>()
export const editorDecorations = new Map<string, { decorationType: TextEditorDecorationType, decorations: DecorationOptions[] }>()

export const onDidChangeActiveTextEditor = (editor: TextEditor | undefined) => {
	if (editor) {
		const decorations = editorDecorations.get(editor.document.uri.toString())
		if (decorations) {
			editor.setDecorations(decorations.decorationType, decorations.decorations)
		}
	}
}
