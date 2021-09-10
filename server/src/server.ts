import { TextDocument } from "vscode-languageserver-textdocument";
import {
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	CompletionItem,
	CompletionItemKind,
	CompletionParams,
	createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DidCloseTextDocumentParams, DocumentColorParams, DocumentFormattingParams, Hover, HoverParams, InitializeParams,
	InitializeResult,
	Position, PrepareRenameParams, ProposedFeatures, Range, RenameParams, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, WorkspaceEdit, _Connection
} from "vscode-languageserver/node";
import { VDF } from "./vdf";
import { VDFExtended } from "./vdf_extended";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

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
				VDF.parse(change.document.getText())
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
			label: "test",
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
						connection.console.log('[VDF] Running formatter...')
						const text = VDF.stringify(VDF.parse(document.getText()))
						connection.console.log('[VDF] Finishined Running formatter')
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
