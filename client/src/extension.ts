import * as path from "path";
import { commands, EndOfLine, ExtensionContext, languages, Location, Position, Range, TextDocument, TextEditor, TextEditorEdit, Uri, workspace } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";
import { VDF, VDFIndentation, VDFNewLine } from "../../shared/vdf";
import * as sortKeysOrders from "./JSON/vdf_sort_keys_orders.json";

const clientsInfo = {
	hudanimations: {
		id: "hudanimations-language-server",
		name: "HUD Animations Language Server",
	},
	vdf: {
		id: "vdf-language-server",
		name: "VDF Language Server",
	},
	popfile: {
		id: "popfile-language-server",
		name: "Popfile Language Server"
	}
}

const clients: Record<keyof typeof clientsInfo, LanguageClient | null> = {
	hudanimations: null,
	vdf: null,
	popfile: null
}

export function activate(context: ExtensionContext): void {

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.formatVDF", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, VDF.stringify(VDF.parse(document.getText(editor.selection)), { indentation }))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), VDF.stringify(VDF.parse(document.getText()), { indentation }))
			languages.setTextDocumentLanguage(document, "json")
		}
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", (editor: TextEditor, edit: TextEditorEdit): void => {
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
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", async (editor: TextEditor, edit: TextEditorEdit, ...params: any[]) => {

		type JSONLocation = { uri: string, range: JSONRange }
		type JSONRange = { start: JSONPosition, end: JSONPosition }
		type JSONPosition = { line: number, character: number }

		// https://code.visualstudio.com/api/references/commands
		// https://github.com/microsoft/vscode/issues/95308#issuecomment-644123877
		await commands.executeCommand(
			"editor.action.showReferences",
			Uri.parse(<string>params[0]),
			new Position((<JSONRange>params[1]).start.line, (<JSONRange>params[1]).start.character),
			(<JSONLocation[]>params[2]).map(i => new Location(Uri.parse(i.uri), new Range(new Position(i.range.start.line, i.range.start.character), new Position(i.range.end.line, i.range.end.character)))),
			"peek"
		)
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.sortVDF", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const ext = document.fileName.split('.').pop()
		if (ext && ((ext): ext is keyof typeof sortKeysOrders => sortKeysOrders.hasOwnProperty(ext))(ext)) {
			const indentation = !editor.options.insertSpaces ? VDFIndentation.Tabs : VDFIndentation.Spaces
			const newLine = document.eol == EndOfLine.CRLF ? VDFNewLine.CRLF : VDFNewLine.LF
			const order = sortKeysOrders[ext]
			const result: string = VDF.stringify(VDF.parse(document.getText()), { indentation, newLine, order })
			edit.replace(new Range(0, 0, document.lineCount, 0), result)
		}
	}))

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", (editor: TextEditor, edit: TextEditorEdit) => {
		const { document } = editor
		const indentation = !editor.options.insertSpaces ? "\t" : "    "
		if (!editor.selection.isEmpty) {
			edit.replace(editor.selection, JSON.stringify(VDF.parse(document.getText(editor.selection)), null, indentation))
		}
		else {
			edit.replace(new Range(0, 0, document.lineCount, 0), JSON.stringify(VDF.parse(document.getText()), null, indentation))
			languages.setTextDocumentLanguage(document, "json")
		}
	}))

	// Language Server

	const onDidOpenTextDocument = (e: TextDocument) => {
		const languageId: string = e.languageId
		if (((languageId): languageId is keyof typeof clientsInfo => clientsInfo.hasOwnProperty(languageId))(languageId)) {
			if (clients[languageId] == null) {

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

				clients[languageId]!.start()
			}
		}
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}

export function deactivate() {
	const promises: Promise<void>[] = []
	let languageId: keyof typeof clients
	for (languageId in clients) {
		if (clients[languageId] != null) {
			promises.push(clients[languageId]!.stop())
		}
	}
	return Promise.all(promises)
}
