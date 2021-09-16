import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL, URL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	CompletionItem,
	CompletionItemKind,
	CompletionParams,
	createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DidCloseTextDocumentParams, DocumentColorParams, DocumentFormattingParams, Hover, HoverParams, InitializeParams,
	InitializeResult, Location, Position, PrepareRenameParams, ProposedFeatures, Range, RenameParams, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, WorkspaceEdit, _Connection
} from "vscode-languageserver/node";
import { HUDTools } from "./hud_tools";
import * as clientscheme from "./JSON/clientscheme.json";
import { VDF } from "./vdf";
import { VDFDocument, VDFExtended, VDFSearch } from "./vdf_extended";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const objects: Record<string, VDFDocument> = {}

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		serverInfo: {
			name: "VDF Language Server"
		},
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: [
					".",
					"\""
				]
			},
			hoverProvider: true,
			definitionProvider: true,
			colorProvider: true,
			documentFormattingProvider: true,
			renameProvider: true,
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				objects[change.document.uri] = VDFExtended.getDocumentObjects(change.document.getText())
				return []
			}
			catch (e: any) {
				return [
					{
						severity: DiagnosticSeverity.Error,
						message: e.message,
						range: Range.create(
							Position.create(e.line, e.character),
							Position.create(e.line, e.character)
						)
					}
				]
			}
		})()
	})
})

connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
	connection.console.log(`Close ${params.textDocument.uri}`)
	connection.sendDiagnostics({
		uri: params.textDocument.uri,
		diagnostics: []
	})
})

connection.onCompletion((params: CompletionParams): CompletionItem[] => {
	return [
		{
			label: "bgcolor_override",
			kind: CompletionItemKind.Text
		}
	]
})

connection.onHover((params: HoverParams): Hover | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: { line: params.position.line, character: 0 },
			end: { line: params.position.line, character: Infinity },
		})
		try {
			const entries = Object.entries(VDF.parse(line))
			if (entries.length) {
				const [key, value] = entries[0]
				return {
					contents: [
						`${key}`,
						`${value}`
					]
				}
			}
		}
		catch (e: any) {
			return undefined
		}
	}
})

connection.onDefinition((params: DefinitionParams): Definition => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const entries = Object.entries(VDF.parse(document.getText({ start: { line: params.position.line, character: 0 }, end: { line: params.position.line, character: Infinity }, })))
		if (entries.length) {
			const [key, value] = entries[0]
			switch (key.toLowerCase()) {
				case "#base": return { uri: `${path.dirname(document.uri)}/${(<string>value).toLowerCase()}`, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
				case "pin_to_sibling": {
					const location: Location | undefined = VDFSearch(new URL(document.uri), objects[document.uri], <string>value, connection)
					if (location) {
						return location
					}
				}
				default:
					{
						// connection.console.log(`Looking for ${value}`)
						let section: keyof typeof clientscheme
						for (section in clientscheme) {
							for (const property of clientscheme[section]) {
								if (key == property) {
									const clientschemePath = `${HUDTools.GetRoot(fileURLToPath(document.uri), connection)}/resource/clientscheme.res`
									// connection.console.log(clientschemePath)
									if (fs.existsSync(clientschemePath)) {
										const clientschemeUri = pathToFileURL(clientschemePath);
										const documentObjects = VDFExtended.getDocumentObjects(fs.readFileSync(clientschemePath, "utf-8"));
										const result = VDFSearch(clientschemeUri, documentObjects, <string>value, connection)
										if (result) {
											connection.console.log(JSON.stringify(result))
											return result
										}
									}
								}
							}

						}
						return []
					}
			}
		}
	}
	return []
})

connection.onDocumentColor((params: DocumentColorParams): ColorInformation[] => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return VDFExtended.getColours(document.getText())
		}
		catch (e: any) {
			return []
		}
	}
	return []
})

connection.onColorPresentation((params: ColorPresentationParams): ColorPresentation[] => {
	const { uri } = params.textDocument
	const { color } = params
	switch (uri.split('.').pop()) {
		case "res": return [{ label: `${Math.round(color.red * 255)} ${Math.round(color.green * 255)} ${Math.round(color.blue * 255)} ${Math.round(color.alpha * 255)}` }]
		default: return [{ label: `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${Math.round(color.alpha)})` }]
	}
})

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return [
				{
					range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
					newText: (() => {
						// connection.console.log('[VDF] Running formatter...')
						const text = VDF.stringify(VDF.parse(document.getText()))
						// connection.console.log('[VDF] Finishined Running formatter')
						return text
					})()
				}
			]
		}
		catch (e: any) {
			return []
		}
	}
	else {
		return []
	}
})

connection.onPrepareRename((params: PrepareRenameParams): Range | undefined => {
	params.position
	const document = documents.get(params.textDocument.uri)
	if (document) {
		return {

			start: {
				line: params.position.line,
				character: params.position.character - 2
			},
			end: {
				line: params.position.line,
				character: params.position.character + 2
			}
		}
	}
})

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: {
				line: params.position.line,
				character: 0
			},
			end: {
				line: params.position.line,
				character: Infinity
			}
		})
		connection.console.log(line)
		connection.console.log(params.newName)

		return {
			changes: VDFExtended.renameToken(document.getText(), "", params.newName, params.textDocument.uri)
		}
	}
	return undefined
})

documents.listen(connection)
connection.listen()
