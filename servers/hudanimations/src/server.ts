import fs, { existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CodeLens, CodeLensParams, CompletionItem, CompletionItemKind, CompletionParams, createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentFormattingParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams, InitializeResult, Location, Position, ProposedFeatures, Range, ReferenceParams, TextDocumentChangeEvent, TextDocuments, TextDocumentSyncKind, TextEdit, _Connection } from "vscode-languageserver/node";
import { getHUDRoot, getLocationOfKey, getVDFDocumentSymbols } from "../../../shared/tools";
import { VDFTokeniser } from "../../../shared/vdf";
import { HUDAnimations, HUDAnimationsSyntaxError, HUDAnimationTypes } from "./hudanimations";
import { getDocumentInfo } from "./hudanimations_symbols";
import { animationCommands, commonProperties, interpolators } from "./hud_animation_types";
import autoCompletionItems from "./JSON/autocompletion.json";
import eventFiles from "./JSON/event_files.json";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const documentHUDAnimations: Record<string, HUDAnimationTypes.File> = {}
const documentsSymbols: Record<string, DocumentSymbol[]> = {}

const eventReferences: Record<string, Record<string, Location[]>> = {}

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
			documentFormattingProvider: true,
			referencesProvider: true,
			documentSymbolProvider: true,
			codeLensProvider: {
				resolveProvider: false
			}
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {

	connection.sendDiagnostics({
		uri: change.document.uri,
		diagnostics: ((): Diagnostic[] => {
			try {
				const documentInfo = getDocumentInfo(change.document.getText())
				documentHUDAnimations[change.document.uri] = documentInfo.animations
				documentsSymbols[change.document.uri] = documentInfo.symbols
				return []
			}
			catch (e: unknown) {
				if (e instanceof HUDAnimationsSyntaxError) {
					connection.console.log(e.message)
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
				return []
			}
		})()
	})
})

documents.onDidClose((params: TextDocumentChangeEvent<TextDocument>) => {
	connection.console.log(`documents.onDidClose ${params.document.uri}`)
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
			let currentToken: string = ""
			while (currentToken != "EOF") {
				currentToken = tokeniser.next()
				tokens.push(currentToken)
			}

			if (tokens.length == 1) {
				return animationCommands
			}

			const animationType = tokens[0].toLowerCase()

			if (((animationType): animationType is keyof typeof autoCompletionItems => autoCompletionItems.hasOwnProperty(animationType))(animationType)) {
				const animationLengths = autoCompletionItems[animationType]
				const length = tokens.length.toString()

				if (((length): length is keyof typeof animationLengths => animationLengths.hasOwnProperty(length))(length)) {
					const instructions = animationLengths[length]
					switch (instructions) {
						case "elements": {
							// Create a list of referencable elements by looking up the current event in event_files.json
							// and get a list of object keys for that file
							const documentSymbols = documentsSymbols[params.textDocument.uri]
							if (documentSymbols) {
								const lineNumber = params.position.line
								let eventName = documentSymbols.find(i => i.range.start.line < lineNumber && i.range.end.line > lineNumber)?.name?.toLowerCase()
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
										addKeys(getVDFDocumentSymbols(fs.readFileSync(`${hudRoot}/${eventFiles[eventName]}`, "utf-8")))
										return keys
									}
									return [{ label: "params.textDocument.uri does not contain a valid hudRoot" }]
								}
								// Suggest other elements in current event
								return [{ label: `${eventName} is not keyof typeof eventFiles` }]
							}
							else {
								return [{ label: "Unable to find events (Missing documentSymbols)" }]
							}
						}
						case "commonProperties": return commonProperties
						case "values": {
							const interpolator = tokens[tokens.length - 1].toLowerCase()
							if (interpolator == "gain" || interpolator == "bias") {
								// Number
								return []
							}
							else {
								return []
							}
						}
						case "interpolators": return interpolators
						case "events": return documentsSymbols[params.textDocument.uri]?.map(i => ({ label: i.name }))
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
			console.log(e.message)
		}




		return null

		// const tokens: string[] = [...line.matchAll(/".*"|\S+/g)].map(i => i[0])

		// connection.console.log(JSON.stringify(tokens) + " - " + tokens.length.toString())
		// switch (tokens.length) {
		// 	// Nothing on line -- Return "event" or animations commands if inside event
		// 	case 0: return lines[0].includes("{") ? commandKeys : eventKey
		// 	case 1: return lines[0].includes("{")
		// 		? (() => {
		// 			switch (tokens[0].toLowerCase()) {
		// 				case "animate": return [{ label: "animatekeys" }]
		// 				case "runevent": return [{ label: "runeventkeys" }]
		// 				default: return null
		// 			}
		// 		})()
		// 		: tokens[0] == "event" ? null : eventKey
		// 	case 2:
		// 		if (tokens[0].toLowerCase() == "event") return null;
		// 	case 3: return null
		// 	case 3: return null
		// 	case 4: return [
		// 		{ label: "Alpha" },
		// 		{ label: "SelectionAlpha" },
		// 		{ label: "FgColor" },
		// 		{ label: "TextScan" },
		// 		{ label: "MenuColor" },
		// 		{ label: "ItemColor" },
		// 		{ label: "Blur" },
		// 		{ label: "PulseAmount" },
		// 		{ label: "Position" },
		// 		{ label: "HintSize" },
		// 		{ label: "icon_expand" },
		// 		{ label: "Ammo2Color" },
		// 		{ label: "Size" },
		// 		{ label: "BgColor" },
		// 		{ label: "xpos" },
		// 		{ label: "wide" },
		// 		{ label: "ypos" },
		// 		{ label: "tall" },
		// 		{ label: "alpha" },
		// 		{ label: "Tall" },
		// 		{ label: "fgcolor" },
		// 	]

		// 	]
		// }
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
			const eventName = tokeniser.next().toLowerCase()
			if (((eventName): eventName is keyof typeof eventFiles => eventFiles.hasOwnProperty(eventName))(eventName)) {
				connection.console.log(`Associated File: *${eventFiles[eventName]}*`)
				return {
					contents: `**Associated File:** ${eventFiles[eventName]}`,
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
							let documentSymbols = documentsSymbols[params.textDocument.uri]
							documentSymbols ??= getDocumentInfo(document.getText()).symbols
							connection.console.log(JSON.stringify(documentSymbols))
							for (const documentSymbol of documentSymbols) {
								if (documentSymbol.range.end.line > params.position.line) {
									const eventName = documentSymbol.name.toLowerCase()
									if (((eventName): eventName is keyof typeof eventFiles => eventFiles.hasOwnProperty(eventName))(eventName)) {
										const hudRoot = getHUDRoot(params.textDocument)
										const filePath = `${hudRoot}/${eventFiles[eventName]}`
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
							let documentSymbols = documentsSymbols[params.textDocument.uri]
							documentSymbols ??= getDocumentInfo(document.getText()).symbols
							const eventSymbol = documentSymbols.find(i => i.name == token)
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
							if (hudRoot) {
								const clientschemePath = `${hudRoot}/resource/clientscheme.res`
								return hudRoot && fs.existsSync(clientschemePath) ? ((): Definition | null => {
									const documentSymbols = getVDFDocumentSymbols(fs.readFileSync(clientschemePath, "utf-8"));
									return getLocationOfKey(clientschemePath, documentSymbols, token)
								})() : null
							}

						}
					default:
						{
							if (tokens[tokenIndex - 2]?.toLowerCase() == "runeventchild") {
								let documentSymbols = documentsSymbols[params.textDocument.uri]
								documentSymbols ??= getDocumentInfo(document.getText()).symbols
								const eventSymbol = documentSymbols.find(i => i.name == token)
								if (eventSymbol) {
									return {
										uri: params.textDocument.uri,
										range: eventSymbol.range
									}
								}
								return null
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

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] | null => {
	try {
		const document = documents.get(params.textDocument.uri)
		if (document) {
			const animations = HUDAnimations.parse(document.getText())
			return [
				{
					range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
					newText: HUDAnimations.stringify(animations, { extraTabs: 2 })
				}
			]
		}
		return null
	}
	catch (e: unknown) {
		if (e instanceof Error) {
			connection.console.log(e.message)
		}
		return null
	}
})

connection.onReferences((params: ReferenceParams) => {
	connection.console.log("connection.onReferences")
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const filePath = `${tmpdir()}/vscode-vdf-show-reference-position.json`
		if (existsSync(filePath)) {
			connection.console.log(`Found ${filePath}`)
			params.position = JSON.parse(readFileSync(filePath, "utf-8"))
		}

		const line = document.getText({
			start: Position.create(params.position.line, 0),
			end: Position.create(params.position.line, Infinity)
		})

		const tokeniser = new VDFTokeniser(line)
		tokeniser.next() // Skip "event"
		const eventName = tokeniser.next().toLowerCase()

		return eventReferences[params.textDocument.uri][eventName]

		// const locations: Location[] = []
		// let animations = documentHUDAnimations[params.textDocument.uri]
		// animations ??= getDocumentInfo(document.getText()).animations
		// for (const event in animations) {
		// 	for (const animation of animations[event]) {
		// 		if (HUDAnimationTypes.animationisType(animation, "RunEvent") || HUDAnimationTypes.animationisType(animation, "StopEvent") || HUDAnimationTypes.animationisType(animation, "RunEventChild")) {
		// 			if (animation.event.toLowerCase() == eventName) {
		// 				connection.console.log(animation.event)
		// 				locations.push({
		// 					uri: params.textDocument.uri,
		// 					range: {
		// 						start: Position.create(animation.referencePosition.line, animation.referencePosition.character - animation.event.length),
		// 						end: Position.create(animation.referencePosition.line, animation.referencePosition.character),
		// 					}
		// 				})
		// 			}
		// 		}
		// 	}
		// }
		// connection.console.log(JSON.stringify(locations, null, "\t"))
		// return locations
	}
})

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return getDocumentInfo(document.getText()).symbols
		}
		catch (e: any) {
			connection.console.error(e)
		}
	}
})

connection.onCodeLens((params: CodeLensParams): CodeLens[] | null => {

	// Every event/animation in the file
	const animations = documentHUDAnimations[params.textDocument.uri]

	// Event declarations in file
	const eventDeclarations: Record<string, Position> = Object.fromEntries(documentsSymbols[params.textDocument.uri].map(i => [i.name.toLowerCase(), i.range.start]))

	// Event references <eventName, eventLocations>
	eventReferences[params.textDocument.uri] = {}
	const documentEventReferences = eventReferences[params.textDocument.uri]

	// Create a list of events in the file and their location all with 0 references,
	// then for each event iterate the animations and add the event
	// reference locations to the list

	// For each event in the list, if the event has more than 0 references,
	// create a code lens

	for (const event in animations) {
		for (const animation of animations[event]) {
			if (HUDAnimationTypes.animationisType(animation, "RunEvent") || HUDAnimationTypes.animationisType(animation, "StopEvent") || HUDAnimationTypes.animationisType(animation, "RunEventChild")) {
				const eventNameKey = animation.event.toLowerCase()
				if (!documentEventReferences.hasOwnProperty(eventNameKey)) {
					documentEventReferences[eventNameKey] = []
				}
				documentEventReferences[eventNameKey].push({
					uri: params.textDocument.uri,
					range: {
						start: Position.create(animation.referencePosition.line, animation.referencePosition.character - animation.event.length),
						end: Position.create(animation.referencePosition.line, animation.referencePosition.character),
					}
				})
			}
		}
	}

	const codeLensItems: CodeLens[] = []
	for (const eventName in eventDeclarations) {
		if (documentEventReferences.hasOwnProperty(eventName)) {
			// Event has references
			codeLensItems.push({
				range: {
					start: Position.create(eventDeclarations[eventName].line, 0),
					end: Position.create(eventDeclarations[eventName].line, Infinity),
				},
				command: {
					title: `${documentEventReferences[eventName].length} reference${documentEventReferences[eventName].length > 1 ? "s" : ""}`,
					command: "vscode-vdf.showReferences",
					arguments: [eventDeclarations[eventName]]
				}
			})
		}
	}

	eventReferences[params.textDocument.uri] = documentEventReferences

	return codeLensItems
})

documents.listen(connection)
connection.listen()
