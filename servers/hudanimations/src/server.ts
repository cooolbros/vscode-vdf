import { existsSync, readFileSync } from "fs";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CodeLens, CodeLensParams, CompletionItem, CompletionItemKind, CompletionParams, createConnection, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentFormattingParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams, InitializeResult, Location, Position, PrepareRenameParams, ProposedFeatures, Range, ReferenceParams, RenameParams, SymbolKind, TextDocumentChangeEvent, TextDocuments, TextDocumentSyncKind, TextEdit, _Connection } from "vscode-languageserver/node";
import { animationisType, File, getHUDAnimationsDocumentInfo, HUDAnimationEventDocumentSymbol, HUDAnimationsSyntaxError } from "../../../shared/hudanimations";
import { clientschemeValues, getCodeLensTitle, getHUDRoot, getLocationOfKey, getVDFDocumentSymbols, VSCodeVDFSettings } from "../../../shared/tools";
import { VDFTokeniser } from "../../../shared/VDF/dist/VDFTokeniser";
import { getHUDAnimationsFormatDocumentSymbols, printHUDAnimationsFormatDocumentSymbols } from "./formatter";
import { animationCommands, commonProperties, interpolators } from "./hud_animation_types";
import autoCompletionItems from "./JSON/autocompletion.json";
import eventFiles from "./JSON/event_files.json";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const documentHUDAnimations: Record<string, File> = {}
const documentsSymbols: Record</* Document Uri */ string, HUDAnimationEventDocumentSymbol[]> = {}

const documentEventReferences: Record</* Document Uri */ string, Record</* event */ string, Location[]>> = {}

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		serverInfo: {
			name: "HUD Animations Language Server"
		},
		capabilities: {
			// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
			textDocumentSync: TextDocumentSyncKind.Full,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: [
					"\""
				]
			},
			hoverProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			documentSymbolProvider: true,
			codeLensProvider: {
				resolveProvider: false
			},
			// colorProvider: true,
			documentFormattingProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {
	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				const { animations, symbols } = getHUDAnimationsDocumentInfo(connection, change.document.getText())
				documentHUDAnimations[change.document.uri] = animations
				documentsSymbols[change.document.uri] = symbols
				return []
			}
			catch (e: unknown) {
				if (e instanceof HUDAnimationsSyntaxError) {
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

documents.onDidClose((params: TextDocumentChangeEvent<TextDocument>) => {
	connection.console.log(`[documents.onDidClose] ${params.document.uri}`)
	connection.sendDiagnostics({
		uri: params.document.uri,
		diagnostics: []
	})
})


connection.onCompletion((params: CompletionParams): CompletionItem[] | null => {

	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, params.position.character)
		})

		try {
			const tokeniser = new VDFTokeniser(line)
			const tokens: string[] = []
			let currentToken: string = tokeniser.next()
			while (currentToken != "EOF") {
				tokens.push(currentToken)
				currentToken = tokeniser.next()
			}

			if (!/\s/.test(line[line.length - 1])) {
				tokens.pop()
			}

			connection.console.log(JSON.stringify(tokens))
			connection.console.log(tokens.length.toString())

			if (tokens.length == 0) {
				return animationCommands
			}

			const animationType = tokens[0].toLowerCase()

			if (((animationType): animationType is keyof typeof autoCompletionItems => autoCompletionItems.hasOwnProperty(animationType))(animationType)) {
				const animationLengths = autoCompletionItems[animationType]
				const length = tokens.length.toString()
				connection.console.log(`Length is ${length}`)
				if (((length): length is keyof typeof animationLengths => animationLengths.hasOwnProperty(length))(length)) {
					const instructions = animationLengths[length]
					connection.console.log(`Instructions are "${instructions}"`)
					switch (instructions) {
						case "elements": {
							// Create a list of referencable elements by looking up the current event in event_files.json
							// and get a list of object keys for that file
							const documentSymbols = documentsSymbols[params.textDocument.uri]

							const lineNumber = params.position.line
							let eventName = documentSymbols?.find(i => i.range.start.line < lineNumber && i.range.end.line > lineNumber)?.name?.toLowerCase()

							// HACK - Search for event name by looking at lines above
							if (eventName == undefined) {
								connection.console.log(`[connection.onCompletion] Searching lines for event name`)
								let _lineNumber = params.position.line
								while (eventName == undefined && _lineNumber > 0) {
									const _line = document.getText({ start: Position.create(_lineNumber, 0), end: Position.create(_lineNumber, Infinity) }).trim()
									if (/event\s+\S+/.test(_line)) {
										eventName = _line.split(/\s+/)[1].toLowerCase()
									}
									_lineNumber--
								}
							}

							if (eventName && ((eventName): eventName is keyof typeof eventFiles => eventFiles.hasOwnProperty(eventName))(eventName)) {
								const hudRoot = getHUDRoot(params.textDocument)
								if (hudRoot) {
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
									addKeys(getVDFDocumentSymbols(readFileSync(`${hudRoot}/${eventFiles[eventName]}`, "utf-8")))
									return keys
								}
								return []
							}
							return []
						}
						case "commonProperties": {
							return commonProperties
						}
						case "values": {
							const interpolator = tokens[tokens.length - 1].toLowerCase()
							if (interpolator == "gain" || interpolator == "bias") {
								// Number
								return []
							}
							else {
								return clientschemeValues(document, "Colors")
							}
						}
						case "interpolators": return interpolators
						case "events": return documentsSymbols[params.textDocument.uri]?.map(i => ({ label: i.name, kind: SymbolKind.Event }))
						default: throw new Error(`${instructions} is not a valid autocomplete item`)
					}
				}
			}
			else {
				// Event
				if (!line.startsWith("event")) {
					return [{ label: "event", kind: CompletionItemKind.Keyword }]
				}
				return null
			}
		}
		catch (e: any) {
			console.log(`[connection.onCompletion] ${e.toString()}`)
		}

		return null
	}
	return null


})

connection.onHover((params: HoverParams): Hover | null => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, Infinity)
		}).trim()
		if (line.startsWith("event")) {
			const tokeniser = new VDFTokeniser(line)
			tokeniser.next() // Skip "event"
			const eventNameKey = tokeniser.next().toLowerCase()
			if (((eventName): eventName is keyof typeof eventFiles => eventFiles.hasOwnProperty(eventName))(eventNameKey)) {
				return {
					contents: `${eventFiles[eventNameKey]}`,
				}
			}
			return null
		}
		return null
	}
	return null
})

connection.onDefinition((params: DefinitionParams) => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, Infinity)
		})
		const matches = line.matchAll(/".*"|\S+/g)
		let tokens: string[] = []
		let tokenIndex = 0
		for (const match of matches) {
			if (match.index! < params.position.character && params.position.character < match.index! + match[0].length) {
				const token: string = match[0]
				switch (tokens[tokenIndex - 1]?.toLowerCase()) {
					case "animate":
						{
							const documentSymbols = documentsSymbols[params.textDocument.uri] ?? getHUDAnimationsDocumentInfo(connection, document.getText()).symbols
							for (const documentSymbol of documentSymbols) {
								if (documentSymbol.range.end.line > params.position.line) {
									const eventName = documentSymbol.name.toLowerCase()
									if (((eventName): eventName is keyof typeof eventFiles => eventFiles.hasOwnProperty(eventName))(eventName)) {
										const hudRoot = getHUDRoot(params.textDocument)
										if (hudRoot == null) return null
										const filePath = `${hudRoot}/${eventFiles[eventName]}`
										if (!existsSync(filePath)) return null
										const vdfDocumentSymbols = getVDFDocumentSymbols(readFileSync(filePath, "utf-8"))
										return getLocationOfKey(pathToFileURL(filePath).href, vdfDocumentSymbols, token)
									}
									return null
								}
							}
							return null
						}
					case "runevent":
					case "stopevent":
						{
							const documentSymbols = documentsSymbols[params.textDocument.uri] ?? getHUDAnimationsDocumentInfo(connection, document.getText()).symbols
							const _token = token.toLowerCase()
							const eventSymbol = documentSymbols.find(i => i.name.toLowerCase() == _token)
							if (eventSymbol) {
								return {
									uri: params.textDocument.uri,
									range: eventSymbol.range
								}
							}
							return null

						}
					case "fgcolor":
					case "bgcolor":
						{
							// Look up colour in clientscheme
							const hudRoot = getHUDRoot(params.textDocument)
							const clientschemePath = `${hudRoot}/resource/clientscheme.res`
							return hudRoot && existsSync(clientschemePath)
								? getLocationOfKey(clientschemePath, getVDFDocumentSymbols(readFileSync(clientschemePath, "utf-8")), token)
								: null
						}
					default:
						{
							if (tokens[tokenIndex - 2]?.toLowerCase() == "runeventchild") {
								const documentSymbols = documentsSymbols[params.textDocument.uri] ?? getHUDAnimationsDocumentInfo(connection, document.getText()).symbols
								const eventSymbol = documentSymbols.find(i => i.name == token)
								return eventSymbol
									? { uri: params.textDocument.uri, range: eventSymbol.range }
									: null
							}
							return null
						}
				}
			}
			tokens.push(match[0])
			tokenIndex++
		}
	}
	return null
})

connection.onReferences((params: ReferenceParams) => {
	connection.console.log("connection.onReferences")
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, Infinity)
		})

		const tokeniser = new VDFTokeniser(line)
		tokeniser.next() // Skip "event"
		const eventName = tokeniser.next().toLowerCase()

		return documentEventReferences[params.textDocument.uri][eventName]
	}
})

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return getHUDAnimationsDocumentInfo(connection, document.getText()).symbols
		}
		catch (e: any) {
			connection.console.error(e)
		}
	}
})

connection.onCodeLens(async (params: CodeLensParams): Promise<CodeLens[] | null> => {
	try {
		const animations = documentsSymbols[params.textDocument.uri]
		const eventReferences: Record<string, { range?: Range, references: Location[] }> = {}

		const showOnAllEvents = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
			scopeUri: params.textDocument.uri,
			section: "vscode-vdf"
		})).hudAnimations.referencesCodeLens.showOnAllEvents

		for (const event of animations) {
			const eventNameKey = event.name.toLowerCase()
			if (!eventReferences.hasOwnProperty(eventNameKey)) {
				eventReferences[eventNameKey] = { range: event.nameRange, references: [] }
			}
			else {
				eventReferences[eventNameKey].range = event.nameRange
			}
			for (const { animation, eventRange } of event.animations) {
				if ((animationisType(animation, "RunEvent") || animationisType(animation, "StopEvent") || animationisType(animation, "RunEventChild")) && eventRange) {
					const referencedEventNameKey = animation.event.toLowerCase()
					if (!eventReferences.hasOwnProperty(referencedEventNameKey)) {
						eventReferences[referencedEventNameKey] = { references: [] }
					}
					eventReferences[referencedEventNameKey].references.push({
						uri: params.textDocument.uri,
						range: eventRange
					})
				}
			}
		}

		const codeLensItems: CodeLens[] = []
		documentEventReferences[params.textDocument.uri] = {}
		for (const key in eventReferences) {
			const eventRef = eventReferences[key]
			if (eventRef.range && (eventRef.references.length > 0 || showOnAllEvents)) {
				codeLensItems.push({
					range: eventRef.range,
					command: {
						title: getCodeLensTitle(eventRef.references.length),
						command: "vscode-vdf.showReferences",
						arguments: [
							params.textDocument.uri,
							eventRef.range,
							eventRef.references
						]
					}
				})
				documentEventReferences[params.textDocument.uri][key] = eventRef.references
			}
		}
		return codeLensItems
	}
	catch (e: any) {
		connection.console.log(`[connection.onCodeLens] ${e.toString()}`)
		return null
	}
})

// connection.onDocumentColor((params: DocumentColorParams): ColorInformation[] | null => {
// 	const document = documents.get(params.textDocument.uri)
// 	if (document) {
// 		try {
// 			const animations = documentsSymbols[params.textDocument.uri]
// 			const documentColours: ColorInformation[] = []
// 			for (const event of animations) {
// 				for (const { animation, valueRange } of event.animations) {
// 					if (animationisType(animation, "Animate") && /\d+\s+\d+\s+\d+\s+\d+/.test(animation.value) && valueRange) {
// 						documentColours.push({
// 							color: {
// 								red: 0,
// 								green: 1,
// 								blue: 0,
// 								alpha: 1
// 							},
// 							range: valueRange
// 						})
// 					}
// 				}
// 			}
// 			return documentColours
// 		}
// 		catch (e: any) {
// 			return null
// 		}
// 	}
// 	return []
// })

// connection.onColorPresentation((params: ColorPresentationParams): ColorPresentation[] => {
// 	const { red, green, blue, alpha } = params.color
// 	return [{ label: `${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)} ${Math.round(alpha * 255)}` }]
// })

connection.onDocumentFormatting(async (params: DocumentFormattingParams): Promise<TextEdit[] | null> => {
	try {
		const document = documents.get(params.textDocument.uri)
		const options = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
			scopeUri: params.textDocument.uri,
			section: "vscode-vdf"
		}))


		if (document) {
			const documentSymbols = getHUDAnimationsFormatDocumentSymbols(document.getText(), connection)
			connection.console.log(JSON.stringify(documentSymbols, null, "\t"))
			return [
				{
					range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
					newText: printHUDAnimationsFormatDocumentSymbols(documentSymbols, connection, options.hudAnimations)
				}
			]
		}
		return null
	}
	catch (e: unknown) {
		if (e instanceof Error) {
			connection.console.log(`[connection.onDocumentFormatting] ${e.toString()}`)
			connection.console.log(`[connection.onDocumentFormatting] ${e.stack!}`)
		}
		else {
			throw e
		}
		return null
	}
})

let oldName: string

connection.onPrepareRename((params: PrepareRenameParams) => {
	for (const event of documentsSymbols[params.textDocument.uri]) {
		if (event.nameRange.start.line == params.position.line) {
			if (event.nameRange.start.character <= params.position.character && params.position.character <= event.nameRange.end.character) {
				oldName = event.name.toLowerCase()
				return event.nameRange
			}
		}
		for (const { animation, eventRange } of event.animations) {
			if ((animationisType(animation, "RunEvent") || animationisType(animation, "StopEvent") || animationisType(animation, "RunEventChild")) && eventRange) {
				if (eventRange.start.line == params.position.line) {
					if (eventRange.start.character <= params.position.character && params.position.character <= eventRange.end.character) {
						oldName = animation.event.toLowerCase()
						return eventRange
					}
				}
			}
		}
	}
	return null
})

connection.onRenameRequest((params: RenameParams) => {
	if (oldName == undefined) {
		throw new Error(`oldName is undefined`)
	}
	const edits: TextEdit[] = []
	for (const event of documentsSymbols[params.textDocument.uri]) {
		if (event.name.toLowerCase() == oldName) {
			edits.push({
				newText: params.newName,
				range: event.nameRange
			})
		}
		for (const { animation, eventRange } of event.animations) {
			if ((animationisType(animation, "RunEvent") || animationisType(animation, "StopEvent") || animationisType(animation, "RunEventChild")) && eventRange) {
				if (animation.event.toLowerCase() == oldName) {
					edits.push({
						newText: params.newName,
						range: eventRange
					})
				}
			}
		}
	}
	return { changes: { [`${params.textDocument.uri}`]: edits } }
})

documents.listen(connection)
connection.listen()
