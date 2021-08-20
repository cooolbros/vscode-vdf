import * as path from "path";
import { commands, EndOfLine, ExtensionContext, languages, Range, TextEditor, TextEditorEdit } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";
import { VDF } from "./vdf";

let client: LanguageClient

export function activate(context: ExtensionContext): void {

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.vdf-to-json", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? "\t" : "    "
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, JSON.stringify(VDF.parse(document.getText(editor.selection)), null, indentation))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), JSON.stringify(VDF.parse(document.getText()), null, indentation))
			languages.setTextDocumentLanguage(document, "json");
		}
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.json-to-vdf", (editor, edit) => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? "Tabs" : "Spaces"
		const eol = document.eol == EndOfLine.CRLF ? "CRLF" : "LF"
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, VDF.stringify(JSON.parse(document.getText(editor.selection)), indentation, eol))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(JSON.parse(document.getText()), indentation, eol))
			languages.setTextDocumentLanguage(document, "vdf");
		}
	}))

	// Language Server
	const serverModule = context.asAbsolutePath(path.join("server", "dist", "server.js"))

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: [
					"--nolazy",
					"--inspect=6009"
				]
			}
		}
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{
				scheme: "file",
				language: "vdf"
			}
		]
	}

	client = new LanguageClient(
		"vdf-language-server",
		"VDF Language Server",
		serverOptions,
		clientOptions
	)

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
