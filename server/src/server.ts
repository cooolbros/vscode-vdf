import { TextDocument } from "vscode-languageserver-textdocument";
import {
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	CompletionItem,
	CompletionItemKind,
	CompletionParams,
	createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentColorParams, DocumentFormattingParams, Hover, HoverParams, InitializeParams,
	InitializeResult,
	Position,
	ProposedFeatures, Range, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, _Connection
} from "vscode-languageserver/node";
import { VDF } from "./vdf";
import { VDFExtended } from "./vdf_extended";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
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
			documentFormattingProvider: true
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
})

connection.onDefinition((params: DefinitionParams): Definition => {
	return []
})

connection.onDocumentColor((params: DocumentColorParams): ColorInformation[] => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		return VDFExtended.getColours(document.getText())
	}
	return []
})

connection.onColorPresentation((params: ColorPresentationParams): ColorPresentation[] => {
	const { color } = params
	return [
		{
			label: `${color.red * 255} ${color.green * 255} ${color.blue * 255} ${color.alpha * 255}`,
		}
	]
})

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		return [
			{
				range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
				newText: VDF.stringify(VDF.parse(document.getText()))
			}
		]
	}
	else {
		return []
	}
})

documents.listen(connection)
connection.listen()
