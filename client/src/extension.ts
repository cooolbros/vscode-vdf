import * as path from "path";
import { commands, EndOfLine, ExtensionContext, languages, Range, TextDocument, TextEditor, TextEditorEdit, workspace } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";
import * as sortKeysOrders from "./JSON/vdf_sort_keys_orders.json";
import { VDF, VDFIndentation, VDFNewLine } from "./vdf";
import { VDFExtended } from "./vdf_extended";

const clientsInfo = {
	vdf: {
		id: "vdf-language-server",
		name: "VDF Language Server",
	},
	hudanimations: {
		id: "hudanimations-language-server",
		name: "HUD Animations Language Server",
	}
}

const clients: Record<string, LanguageClient | undefined> = {}

export function activate(context: ExtensionContext): void {

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.format-vdf", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, VDF.stringify(VDF.parse(document.getText(editor.selection)), indentation))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(VDF.parse(document.getText()), indentation))
			languages.setTextDocumentLanguage(document, "json");
		}
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.json-to-vdf", (editor: TextEditor, edit: TextEditorEdit): void => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
		const eol = document.eol == EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, VDF.stringify(JSON.parse(document.getText(editor.selection)), indentation, eol))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(JSON.parse(document.getText()), indentation, eol))
			languages.setTextDocumentLanguage(document, "vdf");
		}
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.sort-vdf", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const ext = document.fileName.split('.').pop()
		if (((ext): ext is keyof typeof sortKeysOrders => sortKeysOrders.hasOwnProperty(ext))(ext)) {
			const order = sortKeysOrders[ext]
			const result: string = VDFExtended.sort(VDF.parse(document.getText()), order)
			edit.replace(new Range(0, 0, document.lineCount, 0), result)
		}
	}))

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

	const onDidOpenTextDocument = (e: TextDocument) => {
		const languageId: string = e.languageId
		if (((languageId): languageId is keyof typeof clientsInfo => clientsInfo.hasOwnProperty(languageId))(languageId)) {
			if (clients[languageId] == undefined) {

				const serverModule = context.asAbsolutePath(path.join("servers", languageId, "dist", "server.js"))

				const serverOptions: ServerOptions = {
					run: {
						module: serverModule,
						transport: TransportKind.ipc
					},
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
						languageId
					]
				}

				clients[languageId] = new LanguageClient(
					clientsInfo[languageId].id,
					clientsInfo[languageId].name,
					serverOptions,
					clientOptions
				)

				clients[languageId].start();
			}
		}
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument);
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}

export function deactivate() {
	const promises: Promise<void>[] = []
	for (const scheme in clients) {
		promises.push(clients[scheme]?.stop())
	}
	return Promise.all(promises)
}
