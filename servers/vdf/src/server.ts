import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	CodeAction,
	CodeActionParams,
	CodeLens,
	CodeLensParams,
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	Command,
	CompletionItem, CompletionItemKind, CompletionList, CompletionParams,
	createConnection, Definition, DefinitionLink, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentColorParams, DocumentFormattingParams, DocumentLink, DocumentLinkParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams,
	InitializeResult, Location, Position, PrepareRenameParams, ProposedFeatures, Range, ReferenceParams, RenameParams, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, _Connection
} from "vscode-languageserver/node";
import { clientschemeValues, getCodeLensTitle, getDocumentSymbolsAtPosition, getHUDRoot, getLocationOfKey, getVDFDocumentSymbols, RangecontainsPosition, RangecontainsRange, VDFDocumentSymbol, VSCodeVDFSettings } from "../../../shared/tools";
import { VDF, VDFOSTags, VDFSyntaxError, VDFTokeniser } from "../../../shared/vdf";
import { CompletionFiles } from "./files_completion";
import { getVDFFormatDocumentSymbols, printVDFFormatDocumentSymbols } from "./formatter";
import { hudTypes } from "./HUD/keys";
import { statichudKeyBitValues, statichudKeyValues } from "./HUD/values";
import clientscheme from "./JSON/clientscheme.json";
import { VDFExtended } from "./vdf_extended";


const connection: _Connection = createConnection(ProposedFeatures.all)
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const documentsSymbols: Record<string, VDFDocumentSymbol[]> = {}

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

documents.onDidClose((params: TextDocumentChangeEvent<TextDocument>) => {
	connection.console.log(`[documents.onDidClose] ${params.document.uri}`)
	connection.sendDiagnostics({
		uri: params.document.uri,
		diagnostics: []
	})
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
	const document = documents.get(params.textDocument.uri)
	if (document) {
		// Don't call (Range | Position).create because Infinity is an invalid character number
		const line = document.getText({
			start: { line: params.position.line, character: 0 },
			end: { line: params.position.line, character: Infinity }
		})

		let hudRoot: string | undefined | null = undefined

		const entries = Object.entries(VDF.parse(line))
		if (entries.length) {
			let [key, value] = entries[0]

			const valueIndex = line.indexOf(<string>value)

			if (params.position.character < valueIndex) {
				return null
			}

			key = key.replace("_minmode", "").toLowerCase()
			switch (key) {
				case "#base": return { uri: pathToFileURL(path.resolve(path.dirname(fileURLToPath(document.uri)), (<string>value).toLowerCase())).href, range: { start: { line: 0, character: 0 }, end: { line: Infinity, character: Infinity } } }
				case "pin_to_sibling": return getLocationOfKey(document.uri, documentsSymbols[document.uri], <string>value)
				case "labeltext": {

					const searchLocalizationFile = (filePath: string): Definition | null => {
						const documentSymbols = getVDFDocumentSymbols(readFileSync(filePath, "utf16le").substr(1), { allowMultilineStrings: true, osTags: VDFOSTags.Strings });
						const result = getLocationOfKey(filePath, documentSymbols, (<string>value).substr(1))
						return result
					}

					hudRoot ??= getHUDRoot(document)

					if (hudRoot) {
						const chat_englishPath = `${hudRoot}/resource/chat_english.txt`
						const tf_englishPath = `${hudRoot}/../../resource/tf_english.txt`
						return existsSync(chat_englishPath)
							? (searchLocalizationFile(chat_englishPath) ?? searchLocalizationFile(tf_englishPath))
							: existsSync(tf_englishPath) ? searchLocalizationFile(tf_englishPath) : null
					}
					else {
						const teamFortress2Folder = (await connection.workspace.getConfiguration({
							scopeUri: document.uri,
							section: "vscode-vdf"
						})).teamFortess2Folder
						return searchLocalizationFile(`${teamFortress2Folder}/tf/resource/tf_english.txt`)
					}
				}
				case "image":
				case "teambg_1":
				case "teambg_2":
				case "teambg_3": {
					hudRoot ??= getHUDRoot(document)
					let vmtPath: string
					const hudvmtPath = path.normalize(`${hudRoot}/materials/vgui/${value}.vmt`)
					if (existsSync(hudvmtPath)) {
						vmtPath = hudvmtPath
					}
					else {
						const teamFortress2Folder = "C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2"
						const tempDirectory: string = tmpdir()

						const relativeImagePath = path.posix.normalize(`materials/vgui/${value}.vmt`)

						if (existsSync(relativeImagePath)) {
							vmtPath = `${tempDirectory}/${relativeImagePath}`
						}
						else {
							mkdirSync(path.dirname(`${tempDirectory}/${relativeImagePath}`), { recursive: true })

							execSync([
								`"${teamFortress2Folder}/bin/vpk.exe"`,
								"x",
								`"${teamFortress2Folder}/tf/tf2_misc_dir.vpk"`,
								`"${relativeImagePath}"`
							].join(" "), {
								cwd: tempDirectory
							})

							vmtPath = `${tempDirectory}/${relativeImagePath}`
						}
					}
					const targetRange = Range.create(Position.create(0, 0), Position.create(0, 1))
					const result: DefinitionLink[] = [{
						originSelectionRange: Range.create(Position.create(params.position.line, valueIndex), Position.create(params.position.line, valueIndex + (<string>value).length)),
						targetUri: pathToFileURL(vmtPath).href,
						targetRange: targetRange,
						targetSelectionRange: targetRange
					}]
					return result
				}
				case "name": {
					hudRoot ??= getHUDRoot(document)
					const clientschemePath = `${hudRoot}/resource/clientscheme.res`
					return hudRoot && existsSync(clientschemePath) ? getLocationOfKey(clientschemePath, readFileSync(clientschemePath, "utf-8"), "name", <string>value, "CustomFontFiles") : null
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
				if (documentSymbol.name == "pin_to_sibling" && documentSymbol.detail?.toLowerCase() == token && documentSymbol.valueRange) {
					locations.push({
						uri: params.textDocument.uri,
						range: documentSymbol.valueRange
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
		const iterateObject = (documentSymbols: VDFDocumentSymbol[]): (Command | CodeAction)[] => {
			const codeActions: (Command | CodeAction)[] = []
			for (const { name, value, valueRange, children } of documentSymbols) {
				if (value && valueRange && RangecontainsRange(valueRange, params.range)) {

					if (name.toLowerCase() == "#base") {

						const folder = path.dirname(fileURLToPath(params.textDocument.uri))

						// Replace forward and back slashes with system seperator
						const baseRelativePath = path.normalize(value)

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
												range: valueRange
											}
										]
									}
								}
							})
						}
					}

					if (name.toLowerCase() == "image") {
						const oldImagePath = path.normalize(value)
						const newPath = path.relative(`materials${path.sep}vgui`, path.normalize(`materials${path.sep}vgui${path.sep}${value}`))
						if (oldImagePath != newPath) {
							const newBasePath = newPath.split(path.sep).join("/")
							codeActions.push({
								title: "Normalize file path",
								edit: {
									changes: {
										[`${params.textDocument.uri}`]: [
											{

												newText: newBasePath,
												range: valueRange
											}
										]
									}
								}
							})
						}
					}

					return codeActions
				}

				if (children) {
					const result = iterateObject(children)
					if (result.length > 0) {
						return result
					}
				}
			}
			return codeActions
		}
		return iterateObject(documentsSymbols[params.textDocument.uri] ?? [])
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
					if (documentSymbol.name.toLowerCase() == "pin_to_sibling" && documentSymbol.value && documentSymbol.valueRange) {
						const elementName = documentSymbol.value.toLowerCase()
						if (!elementReferences.hasOwnProperty(elementName)) {
							elementReferences[elementName] = { references: [] }
						}
						elementReferences[elementName].references.push({
							uri: params.textDocument.uri,
							range: documentSymbol.valueRange
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

connection.onDocumentLinks((params: DocumentLinkParams) => {
	const documentLinks: DocumentLink[] = []
	try {
		let hudRoot: string | null
		const iterateObject = (documentSymbols: VDFDocumentSymbol[]): void => {
			for (const { name, value, valueRange, children } of documentSymbols) {

				const _name = name.toLowerCase()

				if (_name == "#base" && value && valueRange) {
					connection.console.log(`#base "${dirname(params.textDocument.uri)}/${value}"`)
					documentLinks.push({
						range: valueRange,
						target: `${dirname(params.textDocument.uri)}/${value}`
					})
				}

				if (["image", "teambg_1", "teambg_2", "teambg_3"].includes(_name) && valueRange) {
					hudRoot ??= getHUDRoot(params.textDocument)
					if (hudRoot) {
						documentLinks.push({
							range: valueRange,
							target: `file:///${hudRoot}/materials/vgui/${value}.vmt`
						})
					}
				}

				if (children) {
					iterateObject(children)
				}
			}
		}
		iterateObject(documentsSymbols[params.textDocument.uri] ?? [])
		return documentLinks
	}
	catch (e: unknown) {
		if (e instanceof VDFSyntaxError) {
			connection.console.log(`[connection.onDocumentLinks] ${e.toString()}`)
			return documentLinks
		}
		throw e
	}
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

connection.onDocumentFormatting((params: DocumentFormattingParams): TextEdit[] | null => {
	connection.console.log("[connection.onDocumentFormatting]")
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return [
				{
					range: Range.create(Position.create(0, 0), Position.create(document.lineCount, 0)),
					newText: printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(document.getText(), connection), connection)
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
	const iterateObject = (documentSymbols: VDFDocumentSymbol[]): Range | null => {
		for (const documentSymbol of documentSymbols) {
			if (RangecontainsPosition(documentSymbol.range, params.position)) {
				if (documentSymbol.children) {
					// Permit renaming objects
					oldName = documentSymbol.name.toLowerCase()
					return documentSymbol.range
				}
			}

			const keyKey = documentSymbol.name.toLowerCase()
			if ((keyKey == "fieldname" || keyKey == "pin_to_sibling") && documentSymbol.value && documentSymbol.valueRange) {
				if (RangecontainsPosition(documentSymbol.valueRange, params.position)) {
					// Also permit renaming by reference to object
					oldName = documentSymbol.value.toLowerCase()
					return documentSymbol.valueRange
				}
			}
			else if (documentSymbol.children) {
				const range = iterateObject(documentSymbol.children)
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
	const edits: TextEdit[] = []
	const iterateObject = (documentSymbols: VDFDocumentSymbol[]): void => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.name.toLowerCase() == oldName) {
				edits.push({
					newText: params.newName,
					range: documentSymbol.range
				})
			}

			if (documentSymbol.value && documentSymbol.valueRange) {
				const keyKey = documentSymbol.name.toLowerCase()
				if ((keyKey == "fieldname" || keyKey == "pin_to_sibling") && documentSymbol.value.toLowerCase() == oldName) {
					edits.push({
						newText: params.newName,
						range: documentSymbol.valueRange
					})
				}
			}
			else if (documentSymbol.children) {
				iterateObject(documentSymbol.children)
			}
		}
	}
	iterateObject(documentsSymbols[params.textDocument.uri])
	return { changes: { [`${params.textDocument.uri}`]: edits } }
})

documents.listen(connection)
connection.listen()
