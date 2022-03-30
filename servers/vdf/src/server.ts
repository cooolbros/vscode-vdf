import { existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { dirname, join, normalize } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	CodeAction, CodeActionKind, CodeActionParams,
	CodeLens,
	CodeLensParams,
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	Command,
	CompletionItem, CompletionItemKind, CompletionList, CompletionParams,
	createConnection, Definition, DefinitionLink, DefinitionParams, DocumentColorParams, DocumentFormattingParams, DocumentLink, DocumentLinkParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams,
	InitializeResult, Location, Position, PrepareRenameParams, ProposedFeatures, Range, ReferenceParams, RenameParams, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, _Connection
} from "vscode-languageserver/node";
import { clientschemeValues, getCodeLensTitle, getDocumentSymbolsAtPosition, getHUDRoot, getLocationOfKey, gitUriToFilePath, RangecontainsPosition, RangecontainsRange, VSCodeVDFSettings } from "../../../shared/tools";
import { Configuration } from "../../../shared/tools/dist/configurationManager";
import { _sendDiagnostics } from "../../../shared/tools/dist/sendDiagnostics";
import { VPK } from "../../../shared/tools/dist/VPK";
import { getVDFDocumentSymbols, VDFDocumentSymbol } from "../../../shared/VDF/dist/getVDFDocumentSymbols";
import { VDFOSTags } from "../../../shared/VDF/dist/models/VDFOSTags";
import { VDF } from "../../../shared/VDF/dist/VDF";
import { VDFSyntaxError } from "../../../shared/VDF/dist/VDFErrors";
import { VDFTokeniser } from "../../../shared/VDF/dist/VDFTokeniser";
import { CompletionFiles } from "./files_completion";
import { format } from "./formatter";
import { hudTypes } from "./HUD/keys";
import { statichudKeyBitValues, statichudKeyValues } from "./HUD/values";
import clientscheme from "./JSON/clientscheme.json";
import { validate } from "./validator";

const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)
const documentsSymbols: Record<string, VDFDocumentSymbol[]> = {}
const configuration = new Configuration(connection)

const sendDiagnostics = _sendDiagnostics(connection, getVDFDocumentSymbols, validate)

connection.onInitialize((params: InitializeParams): InitializeResult => {
	connection.console.log("connection.onInitialize")
	return {
		serverInfo: {
			name: "VDF Language Server"
		},
		capabilities: {
			// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
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
			referencesProvider: true,
			documentSymbolProvider: true,
			codeActionProvider: {
				resolveProvider: false
			},
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

documents.onDidOpen((e: TextDocumentChangeEvent<TextDocument>) => {
	configuration.add(e.document.uri)
	documentsSymbols[e.document.uri] = sendDiagnostics(e.document.uri, e.document)!
})

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>): void => {

	const documentConfiguration = configuration.getConfiguration(change.document.uri)
	if (documentConfiguration == undefined) {
		return
	}

	const shouldSendDiagnostics = documentConfiguration.updateDiagnosticsEvent == "type"
	try {
		documentsSymbols[change.document.uri] = getVDFDocumentSymbols(change.document.getText())
		if (shouldSendDiagnostics) {
			sendDiagnostics(change.document.uri, validate(documentsSymbols[change.document.uri]))
		}
	}
	catch (e: unknown) {
		if (e instanceof VDFSyntaxError) {
			if (shouldSendDiagnostics) {
				sendDiagnostics(change.document.uri, e)
			}
			return
		}
		throw e
	}
})

documents.onDidSave((e: TextDocumentChangeEvent<TextDocument>) => {

	const documentConfiguration = configuration.getConfiguration(e.document.uri)
	if (documentConfiguration == undefined) {
		return
	}

	if (documentConfiguration.updateDiagnosticsEvent == "save") {
		sendDiagnostics(e.document.uri, e.document)
	}
})

documents.onDidClose((params: TextDocumentChangeEvent<TextDocument>) => {
	connection.console.log(`[documents.onDidClose] ${params.document.uri}`)
	configuration.remove(params.document.uri)
	sendDiagnostics(params.document.uri, [])
})

connection.onCompletion(async (params: CompletionParams): Promise<CompletionList | CompletionItem[] | null> => {
	try {
		const document = documents.get(params.textDocument.uri)
		if (document) {
			const line = document.getText({
				start: Position.create(params.position.line, 0),
				end: Position.create(params.position.line, params.position.character),
			})
			const tokens = line.split(/\s+/).filter((i) => i != "")
			if (tokens.length <= 1) {
				// Suggest key
				// connection.console.log("Suggesting a key...")
				const documentSymbols = getDocumentSymbolsAtPosition(documentsSymbols[document.uri], params.position)
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
						connection.console.log(`Controlname is ${controlName}`)
						if (((controlName): controlName is keyof typeof hudTypes => hudTypes.hasOwnProperty(controlName))(controlName)) {
							return [...hudTypes[controlName], ...hudTypes.genericHudTypes].filter((i) => !properties.includes(i.label))
						}
						return hudTypes.genericHudTypes.filter((i) => !properties.includes(i.label))
					}
					return null
				}
				return null
			}
			else {
				// Suggest value
				let key = line.split(/[\s"]+/).find((i) => i != "")
				if (key) {
					key = key.replace("_minmode", "").toLowerCase()
					// connection.console.log(`Switching "${key}"`)
					switch (key.toLowerCase()) {
						case "#base": {

							const autoCompletionKind = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
								scopeUri: params.textDocument.uri,
								section: "vscode-vdf"
							})).autoCompletionKind

							const folder = path.dirname(fileURLToPath(document.uri))

							return autoCompletionKind == "incremental"
								? CompletionFiles.Incremental(`${folder}${path.sep}${tokens.pop()?.split(/[\s\r\n"]+/).join("") ?? ""}`)
								: CompletionFiles.All(folder)
						}
						case "image": {
							const hudRoot = getHUDRoot(document)
							if (hudRoot) {
								const autoCompletionKind = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
									scopeUri: params.textDocument.uri,
									section: "vscode-vdf"
								})).autoCompletionKind

								const materials = `${hudRoot}/materials`
								const vgui = `${materials}/vgui`

								return autoCompletionKind == "incremental"
									? CompletionFiles.Incremental(`${vgui}${path.sep}${tokens.pop()?.split(/[\s\r\n"]+/).join("") ?? ""}`, true)
									: CompletionFiles.All(materials, vgui, true)
							}

							return null
						}
						case "pin_to_sibling": {
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
							addKeys(documentsSymbols[params.textDocument.uri])
							return keys
						}
						default: {
							// connection.console.log("default:")

							let section: keyof typeof clientscheme
							for (section in clientscheme) {
								if (clientscheme[section].includes(key)) {
									return clientschemeValues(document, section)
								}
							}

							if (statichudKeyBitValues.includes(key)) {
								return [
									{ label: "1", kind: CompletionItemKind.Value },
									{ label: "0", kind: CompletionItemKind.Value }
								]
							}
							if (statichudKeyValues.hasOwnProperty(key)) {
								return statichudKeyValues[key]
							}
						}
					}

				}
			}
		}
		return []
	}
	catch (e: any) {
		connection.console.log(`[connection.onCompletion] ${e.toString()}`)
		return []
	}
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

connection.onDefinition(async (params: DefinitionParams): Promise<Definition | DefinitionLink[] | null> => {
	try {
		const document = documents.get(params.textDocument.uri)
		if (document) {
			// Don't call (Range | Position).create because Infinity is an invalid character number
			const line = document.getText({
				start: { line: params.position.line, character: 0 },
				end: { line: params.position.line, character: Infinity }
			})

			// string    = hud root directory has been found
			// undefined = hud root directory has not been searched for
			// null      = hud root directory has been searched for, current document is not inside a hud folder
			let hudRoot: string | undefined | null = undefined

			const entries = Object.entries(VDF.parse(line))
			if (entries.length) {
				let [key, value] = entries[0]

				const valueIndex = line.indexOf(<string>value)

				// Do not find definitions for keys
				// TODO replace null with custom result with VDF key
				if (params.position.character < valueIndex) {
					return null
				}

				key = key.replace("_minmode", "").toLowerCase()
				switch (key) {
					case "#base": return { uri: pathToFileURL(path.resolve(path.dirname(fileURLToPath(document.uri)), (<string>value).toLowerCase())).href, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
					case "pin_to_sibling": return getLocationOfKey(document.uri, documentsSymbols[document.uri], <string>value)
					case "labeltext": {

						const searchLocalizationFile = (filePath: string): Definition | null => {
							try {
								const documentSymbols = getVDFDocumentSymbols(readFileSync(filePath, "utf16le").substring(1), { allowMultilineStrings: true, osTags: VDFOSTags.Strings });
								const result = getLocationOfKey(filePath, documentSymbols, (<string>value).substring(1))
								return result
							}
							catch (e: any) {
								connection.console.log(e.toString())
								return null
							}
						}

						hudRoot ??= getHUDRoot(document)

						if (hudRoot) {
							const chat_englishPath = `${hudRoot}/resource/chat_english.txt`
							const tf_englishPath = `${hudRoot}/../../resource/tf_english.txt`

							if (existsSync(chat_englishPath)) {
								const result = searchLocalizationFile(chat_englishPath)
								if (result) {
									return result
								}

								if (existsSync(tf_englishPath)) {
									return searchLocalizationFile(tf_englishPath)
								}
							}
							else if (existsSync(tf_englishPath)) {
								return searchLocalizationFile(tf_englishPath)
							}
						}
						else {
							const teamFortress2Folder = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
								scopeUri: document.uri,
								section: "vscode-vdf"
							})).teamFortress2Folder

							const tf_englishPath = `${teamFortress2Folder}/tf/resource/tf_english.txt`

							if (existsSync(tf_englishPath)) {
								return searchLocalizationFile(tf_englishPath)
							}
						}
						return null
					}
					case "image":
					case "teambg_1":
					case "teambg_2":
					case "teambg_3": {
						hudRoot ??= getHUDRoot(document)
						const relativeVMTPath = normalize(`materials/vgui/${value}.vmt`)
						const hudVmt = hudRoot != null ? join(hudRoot, relativeVMTPath) : null
						if (hudVmt != null && existsSync(hudVmt)) {
							return { uri: pathToFileURL(hudVmt).href, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
						}
						const vpk = new VPK(async () => (await connection.workspace.getConfiguration("vscode-vdf")).teamFortress2Folder)
						const tf2_misc_dir = "tf/tf2_misc_dir.vpk"
						const vpkResult = await vpk.extract(tf2_misc_dir, relativeVMTPath, { returnNullOnError: true })
						return vpkResult != null
							// Use VPK protocol to make document read only
							? { uri: `vpk:///${relativeVMTPath}?vpk=${tf2_misc_dir}&readfromTempDir=true`, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
							: null
					}
					case "name": {
						hudRoot ??= getHUDRoot(document)
						const clientschemePath = `${hudRoot}/resource/clientscheme.res`
						return hudRoot && existsSync(clientschemePath) ? getLocationOfKey(clientschemePath, readFileSync(clientschemePath, "utf-8"), "name", <string>value, "CustomFontFiles") : null
					}
					case "$basetexture": {
						hudRoot ??= getHUDRoot(document)
						if (hudRoot) {
							return {
								uri: `file:///${hudRoot}/materials/${value}.vtf`,
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: Infinity }
								}
							}
						}
						break
					}
					case "font": {
						hudRoot ??= getHUDRoot(document)
						if (hudRoot && existsSync(`${hudRoot}/${value}`)) {
							return {
								uri: `file:///${hudRoot}/${value}`,
								range: {
									start: Position.create(0, 0),
									end: Position.create(0, 1)
								}
							}
						}
						// Dont break ("font" is also a clientscheme property and will be evaluated in the default: section)
					}
					default: {
						let section: keyof typeof clientscheme
						for (section in clientscheme) {
							for (const property of clientscheme[section]) {
								if (key == property) {
									hudRoot ??= getHUDRoot(document)
									const clientschemePath = `${hudRoot}/resource/clientscheme.res`
									return hudRoot && existsSync(clientschemePath) ? ((): Definition | null => {
										const documentSymbols = getVDFDocumentSymbols(readFileSync(clientschemePath, "utf-8"));
										return getLocationOfKey(clientschemePath, documentSymbols, <string>value)
									})() : null
								}
							}
						}
						return null
					}
				}
			}
		}
	}
	catch (e: any) {
		connection.console.log(JSON.stringify(e))
	}

	return null
})

connection.onReferences((params: ReferenceParams): Location[] | null => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const filePath = `${tmpdir()}/vscode-vdf-show-reference-position.json`
		if (existsSync(filePath)) {
			connection.console.log(`Found ${filePath}`)
			params.position = JSON.parse(readFileSync(filePath, "utf-8"))
		}

		const line = document.getText({ start: Position.create(params.position.line, 0), end: Position.create(params.position.line, Infinity) })

		// Assume there is only one token in the element declaration line
		const token = new VDFTokeniser(line).next().toLowerCase()

		const locations: Location[] = []

		const addSymbols = (documentSymbols: VDFDocumentSymbol[]) => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.name == "pin_to_sibling" && documentSymbol.detail?.toLowerCase() == token && documentSymbol.detailRange) {
					locations.push({
						uri: params.textDocument.uri,
						range: documentSymbol.detailRange
					})
				}
				else if (documentSymbol.children) {
					addSymbols(documentSymbol.children)
				}
			}
		}

		addSymbols(documentsSymbols[params.textDocument.uri])

		return locations

	}
	return null
})

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
	return documentsSymbols[params.textDocument.uri]
})

connection.onCodeAction((params: CodeActionParams) => {
	try {
		const iterateObject = (documentSymbols: VDFDocumentSymbol[], parentName: string | null): (Command | CodeAction)[] => {
			const codeActions: (Command | CodeAction)[] = []
			for (const { key, detail, detailRange, children } of documentSymbols) {
				if (detail && detailRange && RangecontainsRange(detailRange, params.range)) {

					if (key.toLowerCase() == "#base") {

						const folder = path.dirname(fileURLToPath(params.textDocument.uri))

						// Replace forward and back slashes with system seperator
						const baseRelativePath = path.normalize(detail)

						// Get #base path relative to textDocument folder path
						const newPath = path.relative(folder, `${folder}${path.sep}${baseRelativePath}`)

						// If the normalized path is not the same as the relative path, push the code action
						if (baseRelativePath != newPath) {
							// Use forward slash seperator
							const newBasePath = newPath.split(path.sep).join("/")
							codeActions.push({
								title: "Normalize file path",
								edit: {
									changes: {
										[`${params.textDocument.uri}`]: [
											{
												newText: newBasePath,
												range: detailRange
											}
										]
									}
								}
							})
						}
					}

					if (key.toLowerCase() == "image") {
						const oldImagePath = path.normalize(detail)
						const newPath = path.relative(`materials${path.sep}vgui`, path.normalize(`materials${path.sep}vgui${path.sep}${detail}`))
						if (oldImagePath != newPath) {
							const newBasePath = newPath.split(path.sep).join("/")
							codeActions.push({
								title: "Normalize file path",
								edit: {
									changes: {
										[`${params.textDocument.uri}`]: [
											{
												newText: newBasePath,
												range: detailRange
											}
										]
									}
								}
							})
						}
					}

					if (key.toLowerCase() == "fieldname") {
						if (parentName != null && detail.toLowerCase() != parentName.toLowerCase()) {
							codeActions.push({
								title: `Change fieldName to "${parentName}"`,
								edit: {
									changes: {
										[`${params.textDocument.uri}`]: [
											{
												newText: parentName,
												range: detailRange
											}
										]
									}
								},
								isPreferred: true,
								kind: CodeActionKind.QuickFix
							})
						}
					}

					return codeActions
				}

				if (children) {
					const result = iterateObject(children, key)
					if (result.length > 0) {
						return result
					}
				}
			}
			return codeActions
		}
		return iterateObject(documentsSymbols[params.textDocument.uri] ?? [], null)
	}
	catch (e: unknown) {
		if (e instanceof VDFSyntaxError) {
			connection.console.log(`[connection.onCodeAction] ${e.toString()}`)
			return []
		}
		throw e
	}
})

connection.onCodeLens(async (params: CodeLensParams): Promise<CodeLens[] | null> => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			const showOnAllElements = (<VSCodeVDFSettings>await connection.workspace.getConfiguration({
				scopeUri: params.textDocument.uri,
				section: "vscode-vdf"
			})).referencesCodeLens.showOnAllElements

			const elementReferences: Record<string, { range?: Range, references: Location[] }> = {}
			const addCodelens = (documentSymbols: VDFDocumentSymbol[]) => {
				for (const documentSymbol of documentSymbols) {
					if (documentSymbol.name.toLowerCase() == "pin_to_sibling" && documentSymbol.detail && documentSymbol.detailRange) {
						const elementName = documentSymbol.detail.toLowerCase()
						if (!elementReferences.hasOwnProperty(elementName)) {
							elementReferences[elementName] = { references: [] }
						}
						elementReferences[elementName].references.push({
							uri: params.textDocument.uri,
							range: documentSymbol.detailRange
						})
					}
					else if (documentSymbol.children) {
						const elementName = documentSymbol.name.toLowerCase()
						if (!elementReferences.hasOwnProperty(elementName)) {
							elementReferences[elementName] = { references: [] }
						}
						elementReferences[elementName].range = documentSymbol.nameRange
						addCodelens(documentSymbol.children)
					}
				}
			}
			addCodelens(documentsSymbols[params.textDocument.uri] ?? getVDFDocumentSymbols(document.getText()))

			const codeLensItems: CodeLens[] = []
			for (const key in elementReferences) {
				const elementRef = elementReferences[key]
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
		}
		catch (e: any) {
			connection.console.log(`[connection.onCodeLens] ${e.toString()}`)
			return null
		}
	}
	return null
})

connection.onDocumentLinks(async (params: DocumentLinkParams) => {

	const documentLinks: DocumentLink[] = []
	const imageProperties = ["image", "teambg_1", "teambg_2", "teambg_3"]

	let folderPath = (<T extends string>(str: string, search: T): str is `${T}${string}` => str.startsWith(search))(params.textDocument.uri, "git:/")
		? dirname(pathToFileURL(gitUriToFilePath(params.textDocument.uri)).href)
		: dirname(params.textDocument.uri)

	let hudRoot: string | null | undefined
	const iterateObject = (documentSymbols: VDFDocumentSymbol[]): void => {
		for (const { key, detail, detailRange, children } of documentSymbols) {
			const _key = key.toLowerCase().replace("_minmode", "")
			if (_key == "#base" && detail && detailRange) {
				documentLinks.push({
					range: detailRange,
					target: `${folderPath}/${detail}`
				})
			}
			else if (imageProperties.includes(_key) && detailRange) {
				hudRoot ??= getHUDRoot(params.textDocument)
				const hudVMT = hudRoot ? path.join(hudRoot, "materials/vgui", `${detail}.vmt`) : null
				documentLinks.push({
					range: detailRange,
					target: hudVMT != null && existsSync(hudVMT) ? pathToFileURL(hudVMT).href : `vpk:///materials/vgui/${detail}.vmt?vpk=tf/tf2_misc_dir.vpk`
				})
			}
			else if (children) {
				iterateObject(children)
			}
		}
	}
	iterateObject(documentsSymbols[params.textDocument.uri] ?? [])
	return documentLinks
})

connection.onDocumentColor((params: DocumentColorParams): ColorInformation[] => {
	const colourPattern: RegExp = /\d+\s+\d+\s+\d+\s+\d+/
	const colours: ColorInformation[] = []
	const addColours = (documentSymbols: VDFDocumentSymbol[]) => {
		for (const { children, detail, detailRange } of documentSymbols) {
			if (children != undefined) {
				addColours(children)
			}
			else if (detail && detailRange) {
				if (colourPattern.test(detail)) {
					const colour = detail.split(/\s+/)
					colours.push({
						color: {
							red: parseInt(colour[0]) / 255,
							green: parseInt(colour[1]) / 255,
							blue: parseInt(colour[2]) / 255,
							alpha: parseInt(colour[3]) / 255
						},
						range: detailRange
					})
				}
			}
		}
	}
	addColours(documentsSymbols[params.textDocument.uri] ?? [])

	return colours
})

connection.onColorPresentation((params: ColorPresentationParams): ColorPresentation[] => {
	const { uri } = params.textDocument
	const { color } = params
	switch (uri.split('.').pop()) {
		case "res": return [{ label: `${Math.round(color.red * 255)} ${Math.round(color.green * 255)} ${Math.round(color.blue * 255)} ${Math.round(color.alpha * 255)}` }]
		default: return [{ label: `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${Math.round(color.alpha)})` }]
	}
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

connection.onPrepareRename((params: PrepareRenameParams) => {

	// Don't allow rename if there are no document symbols
	if (!documentsSymbols[params.textDocument.uri]) {
		return null
	}

	const iterateObject = (documentSymbols: VDFDocumentSymbol[]): Range | null => {
		for (const { name, nameRange, children, detail, detailRange } of documentSymbols) {
			if (RangecontainsPosition(nameRange, params.position)) {
				if (children) {
					// Permit renaming objects
					oldName = name
					return nameRange
				}
			}

			const key = name.split(VDF.OSTagDelimeter)[0].toLowerCase()
			if ((key == "fieldname" || key == "pin_to_sibling") && detail && detailRange) {
				if (RangecontainsPosition(detailRange, params.position)) {
					// Also permit renaming by reference to object
					oldName = detail
					return detailRange
				}
			}
			else if (children) {
				const range = iterateObject(children)
				if (range != null) {
					return range
				}
			}
		}
		return null
	}
	return iterateObject(documentsSymbols[params.textDocument.uri])
})

connection.onRenameRequest((params: RenameParams) => {
	if (oldName == undefined) {
		throw new Error(`oldName is undefined`)
	}
	const oldNameLowerCase = oldName.toLowerCase()

	const changes: { [uri: string]: TextEdit[] } = {}
	const iterateObject = (documentUri: string, documentSymbols: VDFDocumentSymbol[]): void => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.name.split(VDF.OSTagDelimeter)[0].toLowerCase() == oldNameLowerCase) {
				changes[documentUri].push({
					newText: params.newName,
					range: documentSymbol.nameRange
				})
			}

			if (documentSymbol.detail && documentSymbol.detailRange) {
				const keyKey = documentSymbol.key.split(VDF.OSTagDelimeter)[0].toLowerCase()
				if ((keyKey == "fieldname" || keyKey == "pin_to_sibling") && documentSymbol.detail.toLowerCase() == oldNameLowerCase) {
					changes[documentUri].push({
						newText: params.newName,
						range: documentSymbol.detailRange
					})
				}
			}
			else if (documentSymbol.children) {
				iterateObject(documentUri, documentSymbol.children)
			}
		}
	}

	changes[params.textDocument.uri] = []
	iterateObject(params.textDocument.uri, documentsSymbols[params.textDocument.uri])

	const dir = dirname(params.textDocument.uri)
	for (const baseFile of documentsSymbols[params.textDocument.uri].filter((documentSymbol): documentSymbol is VDFDocumentSymbol & { detail: string } => documentSymbol.name.toLowerCase() == "#base" && documentSymbol.detail != undefined)) {
		const baseFileUri = `${dir}/${baseFile.detail}`
		try {
			const baseDocumentSymbols = documentsSymbols.hasOwnProperty(baseFileUri)
				? documentsSymbols[baseFileUri]
				: getVDFDocumentSymbols(readFileSync(fileURLToPath(baseFileUri), "utf-8"))
			changes[baseFileUri] = []
			iterateObject(baseFileUri, baseDocumentSymbols)
		}
		catch (e: any) {
			throw new Error(`Unable to parse file "${fileURLToPath(baseFileUri)}" (${e.message}). Cannot rename "${oldName}"`)
		}
	}

	return { changes }
})

documents.listen(connection)
connection.listen()
