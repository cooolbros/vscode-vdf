import { TextDocument } from "vscode-languageserver-textdocument";
import {
	createConnection, Diagnostic, DiagnosticSeverity, InitializeParams,
	InitializeResult,
	Position,
	ProposedFeatures, Range, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, _Connection
} from "vscode-languageserver/node";
import { VDF } from "./vdf";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental
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

documents.listen(connection)
connection.listen()
