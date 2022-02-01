import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CodeLens, CodeLensParams, ColorInformation, ColorPresentationParams, CompletionItem, CompletionItemKind, CompletionList, CompletionParams, createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentColorParams, DocumentFormattingParams, DocumentLink, DocumentLinkParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams, InitializeResult, Location, Position, PrepareRenameParams, ProposedFeatures, Range, ReferenceParams, RenameParams, TextDocumentChangeEvent, TextDocuments, TextDocumentSyncKind, TextEdit, WorkspaceEdit, _Connection } from "vscode-languageserver/node";
import { getCodeLensTitle, getDocumentSymbolsAtPosition, getLineRange, getLocationOfKey, getVDFDocumentSymbols, RangecontainsPosition, recursiveDocumentSymbolLookup, VDFDocumentSymbol, VSCodeVDFSettings } from "../../../shared/tools";
import { VDF } from "../../../shared/VDF";
import { VDFSyntaxError } from "../../../shared/VDF/dist/VDFErrors";
import { VDFTokeniser } from "../../../shared/VDF/dist/VDFTokeniser";
import { decimalToHexadecimal, hexadecimalToDecimal, hexadecimalToRgb, rgbToHexadecimal } from "./colours";
import { findClassIcon } from "./findClassIcon";
import { format } from "./formatter";
import robot_gatebot from "./JSON/templates/robot_gatebot.json";
import robot_giant from "./JSON/templates/robot_giant.json";
import robot_standard from "./JSON/templates/robot_standard.json";

const autoCompletion = {
	keys: Object.fromEntries(Object.entries<string[]>(require("./JSON/autocompletion/keys.json")).map(([key, values]) => [key, values.map(value => value.startsWith("~") ? ({ label: value.slice(1), kind: CompletionItemKind.Class }) : ({ label: value, kind: CompletionItemKind.Field }))])),
	values: Object.fromEntries(Object.entries<string[]>(require("./JSON/autocompletion/values.json")).map(([key, values]) => [key, values.map(value => value.startsWith("~") ? ({ label: value.slice(1), kind: CompletionItemKind.Class }) : ({ label: value, kind: CompletionItemKind.Field }))])),
	templates: {
		"robot_standard.pop": robot_standard.map(template => ({ label: template, kind: CompletionItemKind.Class })),
		"robot_giant.pop": robot_giant.map(template => ({ label: template, kind: CompletionItemKind.Class })),
		"robot_gatebot.pop": robot_gatebot.map(template => ({ label: template, kind: CompletionItemKind.Class })),
	}
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
			hoverProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			documentSymbolProvider: true,
			codeLensProvider: {
				resolveProvider: false
			},
			documentLinkProvider: {
				resolveProvider: false
			},
			colorProvider: true,
			documentFormattingProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		}
	}
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {
	connection.console.log("[documents.onDidChangeContent]")
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

		let currentToken
		try {
			currentToken = tokeniser.next().toLowerCase()
			if (currentToken == "__eof__" || currentToken.length == 1) {
				suggestKey = true
			}
		}
		catch (e: any) {
			connection.console.log(e.stack)
			suggestKey = true
			currentToken = ""
		}

		if (suggestKey) {
			// Suggest Key
			const documentSymbol = getDocumentSymbolsAtPosition(documentsSymbols[params.textDocument.uri], params.position)?.[0]
			if (documentSymbol != null) {
				const name = documentSymbol.name.toLowerCase()
				connection.console.log(`Suggesting key for object type "${name}"`)
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
					const templates: CompletionItem[] = (documentsSymbols[params.textDocument.uri] ?? [])
						.filter((documentSymbol): documentSymbol is VDFDocumentSymbol & { children: VDFDocumentSymbol[] } => documentSymbol.children != undefined)
						.flatMap((documentSymbol) => documentSymbol.children)
						.filter((documentSymbol): documentSymbol is VDFDocumentSymbol & { children: VDFDocumentSymbol[] } => documentSymbol.name.toLowerCase() == "templates" && documentSymbol.children != undefined)
						.flatMap((documentSymbol) => documentSymbol.children)
						.flatMap((documentSymbol) => ({ label: documentSymbol.name, kind: CompletionItemKind.Class }))
					try {
						const folderPath = dirname(fileURLToPath(params.textDocument.uri))
						const baseFiles = documentsSymbols[params.textDocument.uri].filter(documentSymbol => documentSymbol.name == "#base").map(documentSymbol => documentSymbol.detail)
						for (const baseFile of baseFiles) {
							if (baseFile != undefined) {
								const filePath = join(folderPath, baseFile)
								if (((baseFile): baseFile is keyof typeof autoCompletion.templates => autoCompletion.templates.hasOwnProperty(baseFile))(baseFile)) {
									templates.push(...autoCompletion.templates[baseFile])
								}
								else if (existsSync(filePath)) {
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

documents.onDidClose((params: TextDocumentChangeEvent<TextDocument>) => {
	connection.console.log(`[documents.onDidClose] ${params.document.uri}`)
	connection.sendDiagnostics({
		uri: params.document.uri,
		diagnostics: []
	})
})

connection.onHover((params: HoverParams): Hover | null => {
	const document = documents.get(params.textDocument.uri)
	if (!document) {
		return null
	}

	return {
		contents: {
			kind: "markdown",
			value: "![Tux, the Linux mascot](file:///C:/Users/pfwobcke/.vscode/extensions/vscode-vdf/leaderboard_class_boss_pyro_shiverpeak_00_00_00.png)"
		}
	}

	// const line = document.getText(getLineRange(params.position.line))
	// const tokeniser = new VDFTokeniser(line)
	// if (tokeniser.next().toLowerCase() == `"set item tint rgb"`) {
	// 	const hex = decimalToHexadecimal(parseInt(tokeniser.next()))
	// 	const rgb = hexadecimalToRgb(hex)
	// 	return {
	// 		contents: {
	// 			kind: "plaintext",
	// 			language: "html",
	// 			value: `#${hex} / rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
	// 		}
	// 	}
	// }

	// return {
	// 	contents: [
	// 		{
	// 			language: "popfile",
	// 			value: document.getText(getLineRange(params.position.line)).trim()
	// 		}
	// 	]
	// }
})

connection.onDefinition(async (params: DefinitionParams): Promise<Definition | null> => {
	const document = documents.get(params.textDocument.uri)
	if (!document) {
		return null
	}

	try {
		const documentSymbols = documentsSymbols[params.textDocument.uri]
		const line = document.getText(getLineRange(params.position.line))
		const [key, value] = Object.entries(VDF.parse(line))[0]

		switch (key.toLowerCase()) {
			case "classicon": {
				const teamFortress2Folder = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
					scopeUri: params.textDocument.uri,
					section: "vscode-vdf"
				})).teamFortess2Folder
				const result = findClassIcon(teamFortress2Folder, <string>value)
				return result != null ? { uri: pathToFileURL(result).toString(), range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } } : null
			}
			case "template": {
				return getLocationOfKey(document.uri, documentsSymbols[params.textDocument.uri] ?? document.getText(), <string>value)
			}
			case "waitforallspawned":
			case "waitforalldead": {
				// A WaveSquad is named via the "Name" property and referenced with "WaitForAllSpawned" or "WaitForAllDead"
				const _value = (<string>value).toLowerCase()
				const result = recursiveDocumentSymbolLookup(documentSymbols, (documentSymbol) => documentSymbol.name.toLowerCase() == "name" && documentSymbol.detail?.toLowerCase() == _value)
				return result?.detailRange != null ? { uri: params.textDocument.uri, range: result.detailRange } : null
			}
			default: return null
		}
	}
	catch (e: any) {
		connection.console.log(e.stack)
		return null
	}
})

connection.onReferences((params: ReferenceParams) => {
	const document = documents.get(params.textDocument.uri)
	if (!document) {
		return null
	}

	// Find references for template

	// Assume there is only one token in the element declaration line
	const templateName = new VDFTokeniser(document.getText(getLineRange(params.position.line))).next().toLowerCase()

	const locations: Location[] = []

	const addTemplateReferences = (documentSymbols: VDFDocumentSymbol[]) => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.name.toLowerCase() == "template" && documentSymbol.detail?.toLowerCase() == templateName && documentSymbol.detailRange) {
				locations.push({
					uri: params.textDocument.uri,
					range: documentSymbol.detailRange
				})
			}
			else if (documentSymbol.children) {
				addTemplateReferences(documentSymbol.children)
			}
		}
	}
	addTemplateReferences(documentsSymbols[params.textDocument.uri] ?? [])
	return locations

})

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
	return documentsSymbols[params.textDocument.uri]
})

connection.onCodeLens(async (params: CodeLensParams): Promise<CodeLens[] | null> => {

	const document = documents.get(params.textDocument.uri)
	if (!document) {
		return null
	}

	const showOnAllElements = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
		scopeUri: params.textDocument.uri,
		section: "vscode-vdf"
	})).referencesCodeLens.showOnAllElements

	const templateReferences: Record<string, { range?: Range, references: Location[] }> = {}

	function docSymbolHasChildren(documentSymbol: VDFDocumentSymbol): documentSymbol is VDFDocumentSymbol & { children: VDFDocumentSymbol[] } {
		return documentSymbol.children != undefined
	}

	for (const waveSchedule of (documentsSymbols[params.textDocument.uri] ?? []).filter(docSymbolHasChildren)) {
		for (const documentSymbol of waveSchedule.children) {
			const name = documentSymbol.name.toLowerCase()
			if (name == "templates") {
				// Declare Templates
				for (const template of documentSymbol.children?.filter(docSymbolHasChildren) ?? []) {
					const templateName = template.name.toLowerCase()
					if (!templateReferences.hasOwnProperty(templateName)) {
						templateReferences[templateName] = { references: [] }
					}
					templateReferences[templateName].range = template.nameRange
				}
			}
			if (name == "wave" || name == "mission") {
				// Reference Templates
				const search = (documentSymbols: VDFDocumentSymbol[]): void => {
					for (const documentSymbol of documentSymbols) {
						if (documentSymbol.name.toLowerCase() == "template" && documentSymbol.detail && documentSymbol.detailRange) {
							const templateName = documentSymbol.detail.toLowerCase()
							if (!templateReferences.hasOwnProperty(templateName)) {
								templateReferences[templateName] = { references: [] }
							}
							templateReferences[templateName].references.push({
								uri: params.textDocument.uri,
								range: documentSymbol.detailRange
							})
						}
						if (documentSymbol.children != undefined) {
							search(documentSymbol.children)
						}
					}
				}
				if (documentSymbol.children) {
					search(documentSymbol.children)
				}
			}
		}
	}

	const codeLensItems: CodeLens[] = []

	// Construct Reference CodeLens
	for (const key in templateReferences) {
		const elementRef = templateReferences[key]
		if (elementRef.range && (elementRef.references.length > 0 || showOnAllElements)) {
			codeLensItems.push({
				range: elementRef.range,
				command: {
					title: getCodeLensTitle(elementRef.references.length),
					command: "vscode-vdf.showReferences",
					arguments: [
						params.textDocument.uri,
						elementRef.range,
						elementRef.references
					]
				}
			})
		}
	}

	return codeLensItems
})

connection.onDocumentLinks((params: DocumentLinkParams) => {
	return documentsSymbols[params.textDocument.uri]
		.filter((i): i is VDFDocumentSymbol & { detail: string, detailRange: Range } => i.name.toLowerCase() == "#base" && i.detail != undefined && i.detailRange != undefined)
		.map<DocumentLink>((i) => ({ range: i.detailRange, target: join(dirname(params.textDocument.uri), i.detail) }))
})

connection.onDocumentColor((params: DocumentColorParams) => {
	connection.console.log("[connection.onDocumentColor]")
	const colours: ColorInformation[] = []
	const addColours = (documentSymbols: VDFDocumentSymbol[]) => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.children) {
				addColours(documentSymbol.children)
			}
			else {
				if (documentSymbol.name.toLowerCase() == "set item tint rgb" && documentSymbol.detail && documentSymbol.detailRange) {
					const [r, g, b] = hexadecimalToRgb(decimalToHexadecimal(parseInt(documentSymbol.detail)))
					colours.push({
						range: documentSymbol.detailRange,
						color: {
							red: r / 255,
							green: g / 255,
							blue: b / 255,
							alpha: 255
						}
					})
				}
			}
		}
	}
	addColours(documentsSymbols[params.textDocument.uri] ?? [])

	return colours
})

connection.onColorPresentation((params: ColorPresentationParams) => {
	connection.console.log("[connection.onColorPresentation]")
	const c = params.color
	return [{ label: hexadecimalToDecimal(rgbToHexadecimal(c.red * 255, c.green * 255, c.blue * 255)).toString() }]
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

let oldName: string

connection.onPrepareRename((params: PrepareRenameParams): Range | null => {
	const iterateObject = (documentSymbols: VDFDocumentSymbol[], parentName: string): Range | null => {
		for (const documentSymbol of documentSymbols) {
			if (RangecontainsPosition(documentSymbol.nameRange, params.position) && parentName == "templates") {
				if (documentSymbol.children) {
					// Permit renaming objects inside Templates
					oldName = documentSymbol.name.toLowerCase()
					return documentSymbol.nameRange
				}
			}

			const key = documentSymbol.key.split(VDF.OSTagDelimeter)[0].toLowerCase()
			const renameConditions = [
				key == "template", // Permit renaming by reference to Template
				(key == "name" || key == "waitforallspawned" || key == "waitforalldead") && parentName == "wavespawn", // Permit renaming by declaration or reference to WaveSpawn.Name
			]

			if (renameConditions.includes(true) && documentSymbol.detail && documentSymbol.detailRange) {
				if (RangecontainsPosition(documentSymbol.detailRange, params.position)) {
					oldName = documentSymbol.detail.toLowerCase()
					return documentSymbol.detailRange
				}
			}
			else if (documentSymbol.children) {
				const range = iterateObject(documentSymbol.children, documentSymbol.key.toLowerCase())
				if (range != null) {
					return range
				}
			}
		}
		return null
	}
	return iterateObject(documentsSymbols[params.textDocument.uri] ?? [], "")
})

connection.onRenameRequest((params: RenameParams): WorkspaceEdit => {
	if (oldName == undefined) {
		throw new Error(`oldName is undefined`)
	}
	const edits: TextEdit[] = []

	const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbol[]) => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.name.toLowerCase() == oldName) {
				edits.push({
					range: documentSymbol.nameRange,
					newText: params.newName
				})
			}
			if (documentSymbol.detail?.toLowerCase() == oldName && documentSymbol.detailRange) {
				edits.push({
					range: documentSymbol.detailRange,
					newText: params.newName
				})
			}
			if (documentSymbol.children) {
				iterateDocumentSymbols(documentSymbol.children)
			}
		}
	}

	iterateDocumentSymbols(documentsSymbols[params.textDocument.uri])
	return { changes: { [`${params.textDocument.uri}`]: edits } }
})

documents.listen(connection)
connection.listen()


let s = `sd`
