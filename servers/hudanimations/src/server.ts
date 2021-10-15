import { TextDocument } from "vscode-languageserver-textdocument";
import { createConnection, Hover, HoverParams, InitializeParams, InitializeResult, Position, ProposedFeatures, TextDocuments, TextDocumentSyncKind, _Connection } from "vscode-languageserver/node";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		serverInfo: {
			name: "HUD Animations Language Server"
		},
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			hoverProvider: true,
		}
	}
})

connection.onHover((params: HoverParams): Hover | null => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		return {
			contents: document.getText({
				start: Position.create(params.position.line, 0),
				end: Position.create(params.position.line, Infinity)
			})
		}
	}
	return null
})


documents.listen(connection)
connection.listen()