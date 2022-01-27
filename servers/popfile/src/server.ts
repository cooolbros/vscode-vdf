import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem, CompletionItemKind, CompletionList, CompletionParams, createConnection, Diagnostic, DiagnosticSeverity, DocumentFormattingParams, InitializeParams, InitializeResult, Position, ProposedFeatures, Range, TextDocumentChangeEvent, TextDocuments, TextDocumentSyncKind, TextEdit, _Connection } from "vscode-languageserver/node";
import { getDocumentSymbolsAtPosition, getVDFDocumentSymbols, VDFDocumentSymbol } from "../../../shared/tools";
import { VDF } from "../../../shared/VDF";
import { VDFSyntaxError } from "../../../shared/VDF/dist/VDFErrors";
import { VDFTokeniser } from "../../../shared/VDF/dist/VDFTokeniser";
import { format } from "./formatter";

const autoCompletion = {
	keys: Object.fromEntries(Object.entries<string[]>(require("./JSON/autocompletion/keys.json")).map(([key, values]) => [key, values.map(value => value.startsWith("~") ? ({ label: value.slice(1), kind: CompletionItemKind.Class }) : ({ label: value, kind: CompletionItemKind.Field }))])),
	values: Object.fromEntries(Object.entries<string[]>(require("./JSON/autocompletion/values.json")).map(([key, values]) => [key, values.map(value => value.startsWith("~") ? ({ label: value.slice(1), kind: CompletionItemKind.Class }) : ({ label: value, kind: CompletionItemKind.Field }))]))
}

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const documentsSymbols: Record<string, VDFDocumentSymbol[]> = {}

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	connection.console.log(JSON.stringify(Object.keys(autoCompletion.keys).map(k => k[0])))
	connection.console.log(JSON.stringify(Object.keys(autoCompletion.values).map(k => k[0])))
	return {
		serverInfo: {
			name: "Popfile Language Server"
		},
		capabilities: {
			// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
			textDocumentSync: TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: [
					".",
					"\"",
					"/",
					...Object.keys(autoCompletion.keys).map(k => k[0]),
					...Object.keys(autoCompletion.values).map(k => k[0]),
				],
				workDoneProgress: true
			},
			documentFormattingProvider: true,
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {
	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				documentsSymbols[change.document.uri] = getVDFDocumentSymbols(change.document.getText())
				return []
			}
			catch (e: unknown) {
				if (e instanceof VDFSyntaxError) {
					connection.console.log(`[documents.onDidChangeContent] ${e.toString()}`)
					return [
						{
							severity: DiagnosticSeverity.Error,
							message: e.toString(),
							range: e.range,
						}
					]
				}
				throw e
			}
		})()
	})
})

connection.onCompletion(async (params: CompletionParams): Promise<CompletionList | CompletionItem[] | null> => {

	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({ start: { line: params.position.line, character: 0 }, end: { line: params.position.line, character: params.position.character } })

		connection.console.log(`"${line}"`)
		const tokeniser = new VDFTokeniser(line)

		let suggestKey = false

		const currentToken = tokeniser.next().toLowerCase()

		if (currentToken == "__eof__" || currentToken.length == 1) {
			suggestKey = true
		}


		if (suggestKey) {
			// Suggest Key
			const documentSymbol = getDocumentSymbolsAtPosition(documentsSymbols[params.textDocument.uri], params.position)?.[0]
			if (documentSymbol != null) {
				const name = documentSymbol.name.toLowerCase()
				if (autoCompletion.keys.hasOwnProperty(name)) {
					return autoCompletion.keys[name]
				}
			}
			else {
				return autoCompletion.keys["_"]
			}
		}
		else {
			// Suggest Value
			switch (currentToken.toLowerCase()) {
				case "#base": {
					return [
						{ label: "robot_standard.pop", kind: CompletionItemKind.Reference },
						{ label: "robot_giant.pop", kind: CompletionItemKind.Reference },
						{ label: "robot_gatebot.pop", kind: CompletionItemKind.Reference },
						...(readdirSync(dirname(fileURLToPath(params.textDocument.uri)))
							.filter(file => file.endsWith(".pop"))
							.map(file => ({ label: file, kind: CompletionItemKind.File })))
					]
				}
				case "template": {
					const templates: CompletionItem[] = []
					try {
						const folderPath = dirname(fileURLToPath(params.textDocument.uri))
						const baseFiles = documentsSymbols[params.textDocument.uri].filter(documentSymbol => documentSymbol.name == "#base").map(documentSymbol => documentSymbol.detail)
						for (const baseFile of baseFiles) {
							if (baseFile != undefined) {
								const filePath = join(folderPath, baseFile)
								if (existsSync(filePath)) {
									const obj = VDF.parse(readFileSync(filePath, "utf-8"))
									for (const key in obj) {
										const value = obj[key]
										if (typeof value == "object") {
											for (const item of Array.isArray(value) ? value : [value]) {
												if (typeof item == "object") {
													for (const key1 in item) {
														if (key1.toLowerCase() == "templates") {
															templates.push(...Object.keys(item[key1]).map(template => ({ label: template, kind: CompletionItemKind.Class })))
														}
													}
												}
											}
										}
									}
								}
							}
						}
					}
					catch (e: any) {
						connection.console.log(e.stack)
					}
					return templates
				}
				default: {
					if (autoCompletion.values.hasOwnProperty(currentToken)) {
						return autoCompletion.values[currentToken]
					}
				}
			}
		}

	}
	return null
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
