import type { Uri } from "common/Uri"
import vscode from "vscode"

export class Decorations {

	private readonly stack: DisposableStack
	private readonly decorationType: vscode.TextEditorDecorationType
	private readonly decorations: Map<string, vscode.DecorationOptions[]>

	public constructor() {
		this.stack = new DisposableStack()

		this.decorationType = this.stack.adopt(
			vscode.window.createTextEditorDecorationType({
				after: {
					margin: "0 0 0 0.5rem",
					color: "#99999959",
				}
			}),
			(decorationType) => decorationType.dispose()
		)

		this.decorations = new Map()

		this.stack.adopt(
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					const decorations = this.decorations.get(editor.document.uri.toString())
					if (decorations) {
						editor.setDecorations(this.decorationType, decorations)
					}
				}
			}),
			(disposable) => disposable.dispose()
		)
	}

	public setDecorations(uri: Uri, decorations: vscode.DecorationOptions[]) {
		this.decorations.set(uri.toString(), decorations)
		const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() == uri.toString())
		if (editor) {
			editor.setDecorations(this.decorationType, decorations)
		}
	}

	public removeDecorations(uri: Uri) {
		this.decorations.delete(uri.toString())
		const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() == uri.toString())
		if (editor) {
			editor.setDecorations(this.decorationType, [])
		}
	}

	public dispose() {
		this.stack.dispose()
	}
}
