import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	CompletionItem, CompletionItemKind, CompletionList, CompletionParams,
	createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DidCloseTextDocumentParams, DocumentColorParams, DocumentFormattingParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams,
	InitializeResult, Position, ProposedFeatures, Range, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, _Connection
} from "vscode-languageserver/node";
import { genericHudTypes, hudTypes } from "./HUD/keys";
import { statichudKeyBitValues, statichudKeyValues } from "./HUD/values";
import { HUDTools } from "./hud_tools";
import * as clientscheme from "./JSON/clientscheme.json";
import { VDF } from "./vdf";
import { VDFExtended } from "./vdf_extended";
import { VDFOSTags } from "./vdf_tokeniser";


const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const objects: Record<string, DocumentSymbol[]> = {}

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
					"\"",
					"/"
				],
				workDoneProgress: true
			},
			hoverProvider: true,
			definitionProvider: true,
			colorProvider: true,
			documentFormattingProvider: true,
			// renameProvider: true,
			documentSymbolProvider: true,
			// codeLensProvider: {
			// 	resolveProvider: false
			// },
			// referencesProvider: true
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				objects[change.document.uri] = VDFExtended.getDocumentSymbols(change.document.getText())
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

connection.onCompletion((params: CompletionParams): CompletionItem[] | CompletionList => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, Infinity),
		})
		const tokens = line.split(/\s+/).filter((i) => i != "")
		if (tokens.length == 1) {
			// Suggest key
			const documentSymbols = VDFExtended.Searcher.getObjectAtLocation(objects[document.uri], params.position)
			if (documentSymbols) {
				let controlName: string = ""
				const properties: string[] = []
				for (const documentSymbol of documentSymbols) {
					properties.push(documentSymbol.name)
					if (documentSymbol.name.toLowerCase() == "controlname" && documentSymbol.detail) {
						controlName = documentSymbol.detail.toLowerCase()
					}
				}

				if (controlName != "") {
					if (((controlName): controlName is keyof typeof hudTypes => hudTypes.hasOwnProperty(controlName))(controlName)) {
						return [...hudTypes[controlName], ...genericHudTypes].filter((i) => !properties.includes(i.label))
					}
					return genericHudTypes
				}
				return genericHudTypes
			}
		}
		else {
			// Suggest value
			// connection.console.log(JSON.stringify(line.split(/[\s"]+/)))
			let property = line.split(/[\s"]+/).find((i) => i != "")
			if (property) {
				property = property.toLowerCase()
				switch (property.toLowerCase()) {
					case "#base":
						{
							const items: CompletionItem[] = []
							let basePath: string = ""
							const _path = tokens.pop()
							if (_path) {
								basePath = _path.split(/[\s\r\n"]+/).join("")
							}
							const absoluteBasePath = `${path.dirname(fileURLToPath(document.uri))}/${basePath}/`
							connection.console.log(absoluteBasePath)
							if (fs.existsSync(absoluteBasePath)) {
								for (const item of fs.readdirSync(absoluteBasePath)) {
									items.push({
										label: item,
										kind: fs.statSync(`${absoluteBasePath}/${item}`).isFile() ? CompletionItemKind.File : CompletionItemKind.Folder,
										commitCharacters: [
											"/"
										]
										// detail: "some detaul :-)"
									})
								}
								return {
									isIncomplete: true,
									items: items,
								}
							}
							break;
						}

					case "image":
						{
							const hudRoot = HUDTools.GetRoot(fileURLToPath(document.uri))
							const images: Set<string> = new Set()
							const iterateDir = (relativeFolderPath: string) => {
								for (const item of fs.readdirSync(`${hudRoot}/${relativeFolderPath}/`)) {
									if (!fs.statSync(`${hudRoot}/${relativeFolderPath}/${item}`).isFile()) {
										iterateDir(`${relativeFolderPath}/${item}`)
									}
									else {
										images.add(`${path.relative(`${hudRoot}/materials/vgui`, `${hudRoot}/${relativeFolderPath}`)}\\${path.parse(item).name}`.split('\\').join('/'))
									}
								}
							}
							iterateDir(`materials`)
							return Array.from(images).map((i) => ({
								label: i,
								kind: CompletionItemKind.Field
							}))

						}
					case "pin_to_sibling":
						{
							try {
								const keys: CompletionItem[] = []
								const addKeys = (documentSymbols: DocumentSymbol[]) => {
									for (let documentSymbol of documentSymbols) {
										if (documentSymbol.children) {
											keys.push({
												label: documentSymbol.name,
												kind: CompletionItemKind.Variable
											})
											addKeys(documentSymbol.children)
										}
									}
								}
								addKeys(objects[params.textDocument.uri])
								return keys
							}
							catch (e: any) {
								connection.console.error(e)
								return []
							}
							break
						}
					default:
						{
							const sectionIcons: Record<keyof typeof clientscheme, CompletionItemKind> = {
								"Colors": CompletionItemKind.Color,
								"Borders": CompletionItemKind.Snippet,
								"Fonts": CompletionItemKind.Text,
							}

							let section: keyof typeof clientscheme
							for (section in clientscheme) {
								if (clientscheme[section].includes(property)) {
									const hudRoot = HUDTools.GetRoot(fileURLToPath(document.uri))
									const clientschemePath = `${hudRoot}/resource/clientscheme.res`
									let detailsGenerator: (data: any) => string = (() => {
										switch (section) {
											case "Colors": return (data: any): string => data;
											case "Borders": return (data: any): string => "";
											case "Fonts": return (data: any): string => `${data["1"]?.name ?? ""} ${data["1"]?.tall ?? ""}`;
										}
									})()

									if (fs.existsSync(clientschemePath)) {
										const hudclientscheme = HUDTools.loadControls(clientschemePath)
										return Object.keys(hudclientscheme["Scheme"][section]).map((i) => ({
											label: i,
											kind: sectionIcons[section],
											detail: detailsGenerator(hudclientscheme["Scheme"][section][i])
										}))
									}
								}
							}

							if (statichudKeyBitValues.includes(property)) {
								return [
									{ label: "1", kind: CompletionItemKind.Enum },
									{ label: "0", kind: CompletionItemKind.Enum }
								]
							}
							if (statichudKeyValues.hasOwnProperty(property)) {
								return statichudKeyValues[property]
							}
						}
				}

			}
		}
	}
	return []
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
					contents: {
						kind: "markdown",
						language: "vdf",
						value: `"${key}"\t\t"${value}"`
					}
				}
			}
		}
		catch (e: any) {
			return undefined
		}
	}
})

connection.onDefinition((params: DefinitionParams): Definition | null => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		connection.console.log(params.textDocument.uri)
		connection.console.log(document.uri)
		const entries = Object.entries(VDF.parse(document.getText({ start: { line: params.position.line, character: 0 }, end: { line: params.position.line, character: Infinity }, })))
		if (entries.length) {
			const [key, value] = entries[0]
			switch (key.toLowerCase()) {
				case "#base": return { uri: `${path.dirname(document.uri)}/${(<string>value).toLowerCase()}`, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
				case "pin_to_sibling": return VDFExtended.Searcher.getLocationOfKey(document.uri, objects[document.uri], <string>value)
				case "labeltext": {

					const searchLocalizationFile = (filePath: string): Definition | null => {
						const documentSymbols = VDFExtended.getDocumentSymbols(fs.readFileSync(filePath, "utf16le").substr(1), { allowMultilineStrings: true, osTags: VDFOSTags.Strings });
						const result = VDFExtended.Searcher.getLocationOfKey(filePath, documentSymbols, (<string>value).substr(1))
						connection.console.log(JSON.stringify(result, null, 4))
						return result
					}

					const hudRoot = HUDTools.GetRoot(fileURLToPath(document.uri))
					if (hudRoot) {
						const chat_englishPath = `${hudRoot}/resource/chat_english.txt`
						const tf_englishPath = `${hudRoot}/../../resource/tf_english.txt`
						return fs.existsSync(chat_englishPath)
							? (searchLocalizationFile(chat_englishPath) ?? searchLocalizationFile(tf_englishPath))
							: fs.existsSync(tf_englishPath) ? searchLocalizationFile(tf_englishPath) : null
					}
					else {
						return searchLocalizationFile("C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf/resource/tf_english.txt")
					}
				}
				default: {
					let section: keyof typeof clientscheme
					for (section in clientscheme) {
						for (const property of clientscheme[section]) {
							if (key == property) {
								const clientschemePath = `${HUDTools.GetRoot(fileURLToPath(document.uri))}/resource/clientscheme.res`
								if (fs.existsSync(clientschemePath)) {
									const documentSymbols = VDFExtended.getDocumentSymbols(fs.readFileSync(clientschemePath, "utf-8"), { osTags: VDFOSTags.All });
									const result = VDFExtended.Searcher.getLocationOfKey(clientschemePath, documentSymbols, <string>value)
									if (result) {
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

// connection.onPrepareRename((params: PrepareRenameParams): Range | undefined => {
// 	params.position
// 	const document = documents.get(params.textDocument.uri)
// 	if (document) {
// 		return {

// 			start: {
// 				line: params.position.line,
// 				character: params.position.character - 2
// 			},
// 			end: {
// 				line: params.position.line,
// 				character: params.position.character + 2
// 			}
// 		}
// 	}
// })

// connection.onRenameRequest((params: RenameParams): WorkspaceEdit | undefined => {
// 	const document = documents.get(params.textDocument.uri)
// 	if (document) {
// 		const line = document.getText({
// 			start: {
// 				line: params.position.line,
// 				character: 0
// 			},
// 			end: {
// 				line: params.position.line,
// 				character: Infinity
// 			}
// 		})
// 		connection.console.log(line)
// 		connection.console.log(params.newName)

// 		return {
// 			changes: VDFExtended.renameToken(document.getText(), "", params.newName, params.textDocument.uri)
// 		}
// 	}
// 	return undefined
// })

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return VDFExtended.getDocumentSymbols(document.getText())
		}
		catch (e: any) {
			connection.console.error(e)
		}
	}
})

// connection.onCodeLens((params: CodeLensParams): CodeLens[] | undefined => {
// 	try {
// 		const document = documents.get(params.textDocument.uri)
// 		if (document) {
// 			return VDFExtended.getCodeLens(document.uri, document.getText(), connection)
// 		}
// 	}
// 	catch (e: any) {
// 		connection.console.error(e)
// 	}
// })

// connection.onCodeLensResolve((params: CodeLens): CodeLens => {
// 	connection.console.log(JSON.stringify(params))
// 	return {
// 		command: {
// 			title: `${params.data.references.length} references`,
// 			command: "editor.action.goToReferences",
// 			arguments: [
// 				params.data.uri,
// 				params.range.start,
// 				params.range.end,
// 			]
// 		},
// 		range: params.range
// 	}
// })

// connection.onReferences((params: ReferenceParams): Location[] | undefined => {
// 	const document = documents.get(params.textDocument.uri)
// 	if (document) {
// 		const line = document.getText({
// 			start: Position.create(params.position.line, 0),
// 			end: Position.create(params.position.line, Infinity)
// 		}).trim().split('"').join("")
// 		return VDFExtended.getElementReferences(document.uri, document.getText(), line)
// 	}
// })

documents.listen(connection)
connection.listen()
