import vscode from "vscode"

export const decorationTypes = new Map<string, vscode.TextEditorDecorationType>()
export const editorDecorations = new Map<string, { decorationType: vscode.TextEditorDecorationType, decorations: vscode.DecorationOptions[] }>()

export const onDidChangeActiveTextEditor = (editor: vscode.TextEditor | undefined) => {
	if (editor) {
		const decorations = editorDecorations.get(editor.document.uri.toString())
		if (decorations) {
			editor.setDecorations(decorations.decorationType, decorations.decorations)
		}
	}
}
