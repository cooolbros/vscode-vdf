import { TextDocument } from "vscode-languageserver-textdocument";
import { createConnection, Diagnostic, DiagnosticSeverity, DocumentFormattingParams, InitializeParams, InitializeResult, Position, ProposedFeatures, Range, TextDocumentChangeEvent, TextDocuments, TextDocumentSyncKind, TextEdit, _Connection } from "vscode-languageserver/node";
import { getVDFDocumentSymbols, VDFDocumentSymbol } from "../../../shared/tools";
import { VDFSyntaxError } from "../../../shared/vdf";
import { format } from "./formatter";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const documentsSymbols: Record<string, VDFDocumentSymbol[]> = {}

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		serverInfo: {
			name: "Population Language Server"
		},
		capabilities: {
			// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
			textDocumentSync: TextDocumentSyncKind.Full,
			documentFormattingProvider: true,
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {
	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				const documentSymbols = getVDFDocumentSymbols(change.document.getText())
				documentsSymbols[change.document.uri] = documentSymbols
				return []
			}
			catch (e: unknown) {
				if (e instanceof VDFSyntaxError) {
					connection.console.log(`[documents.onDidChangeContent] ${e.toString()}`)
					return [
						{
							severity: DiagnosticSeverity.Error,
							message: e.message,
							range: e.range
						}
					]
				}
				throw e
			}
		})()
	})
})

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] | null => {
	connection.console.log("[connection.onDocumentFormatting]")
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return [
				{
					range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
					newText: format(document.getText(), connection)
				}
			]
		}
		catch (e: unknown) {
			if (e instanceof Error) {
				connection.console.log(e.message)
				connection.console.log(e.stack!)
			}
			return []
		}
	}
	else {
		return []
	}
})

documents.listen(connection)
connection.listen()
