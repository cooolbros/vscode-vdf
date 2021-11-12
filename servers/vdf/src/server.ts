import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	CodeLens,
	CodeLensParams,
	ColorInformation,
	ColorPresentation,
	ColorPresentationParams,
	CompletionItem, CompletionItemKind, CompletionList, CompletionParams,
	createConnection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentColorParams, DocumentFormattingParams, DocumentSymbol, DocumentSymbolParams, Hover, HoverParams, InitializeParams,
	InitializeResult, Location, Position, ProposedFeatures, Range, ReferenceParams, TextDocumentChangeEvent, TextDocuments,
	TextDocumentSyncKind, TextEdit, _Connection
} from "vscode-languageserver/node";
import { clientschemeValues, getCodeLensTitle, getHUDRoot, getLocationOfKey, getVDFDocumentSymbols, VDFDocumentSymbol, VSCodeVDFSettings } from "../../../shared/tools";
import { VDF, VDFIndentation, VDFOSTags, VDFSyntaxError, VDFTokeniser } from "../../../shared/vdf";
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
			codeLensProvider: {
				resolveProvider: false
			},
			colorProvider: true,
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
	connection.console.log(`documents.onDidClose ${params.document.uri}`)
	connection.sendDiagnostics({
		uri: params.document.uri,
		diagnostics: []
	})
})

connection.onCompletion((params: CompletionParams): CompletionItem[] | CompletionList | null => {
	try {
		const document = documents.get(params.textDocument.uri)
		if (document) {
			const line = document.getText({
				start: Position.create(params.position.line, 0),
				end: Position.create(params.position.line, params.position.character),
			})
			const tokens = line.split(/\s+/).filter((i) => i != "")
			if (tokens.length == 1) {
				// Suggest key
				const documentSymbols = VDFExtended.Searcher.getObjectAtLocation(documentsSymbols[document.uri], params.position)
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
							return [...hudTypes[controlName], ...hudTypes.genericHudTypes].filter((i) => !properties.includes(i.label))
						}
						return null
						// return hudTypes.genericHudTypes.filter((i) => !properties.includes(i.label))
					}
					// return hudTypes.genericHudTypes.filter((i) => !properties.includes(i.label))
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
							const items: CompletionItem[] = []
							let basePath: string = ""
							const _path = tokens.pop()
							if (_path) {
								basePath = _path.split(/[\s\r\n"]+/).join("")
							}
							const absoluteBasePath = `${path.dirname(fileURLToPath(document.uri))}/${basePath}/`
							// connection.console.log(absoluteBasePath)
							if (existsSync(absoluteBasePath)) {
								for (const item of readdirSync(absoluteBasePath)) {
									items.push({
										label: item,
										kind: statSync(`${absoluteBasePath}/${item}`).isFile() ? CompletionItemKind.File : CompletionItemKind.Folder,
										commitCharacters: [
											"/"
										]
									})
								}
								return {
									isIncomplete: true,
									items: items,
								}
							}
							break;
						}
						case "image": {
							const hudRoot = getHUDRoot(document)
							const images: Set<string> = new Set()
							const iterateDir = (relativeFolderPath: string) => {
								for (const item of readdirSync(`${hudRoot}/${relativeFolderPath}/`)) {
									if (!statSync(`${hudRoot}/${relativeFolderPath}/${item}`).isFile()) {
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
								kind: CompletionItemKind.File
							}))
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
		connection.console.log(e.message)
		// connection.console.log(JSON.stringify(e, null, "\t"))
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

connection.onDefinition(async (params: DefinitionParams): Promise<Definition | null> => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		const line: string = document.getText({ start: { line: params.position.line, character: 0 }, end: { line: params.position.line, character: Infinity }, })
		let hudRoot: string | undefined | null = undefined
		const entries = Object.entries(VDF.parse(line))
		if (entries.length) {
			let [key, value] = entries[0]
			if (params.position.character < line.indexOf(<string>value)) {
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
					return {
						uri: pathToFileURL(vmtPath).href,
						range: {
							start: Position.create(0, Infinity),
							end: Position.create(Infinity, Infinity)
						}
					}
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

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] | undefined => {
	const document = documents.get(params.textDocument.uri)
	if (document) {
		try {
			return getVDFDocumentSymbols(document.getText())
		}
		catch (e: any) {
			connection.console.error(e)
		}
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
					const value: string | undefined = documentSymbol.value?.toLowerCase()
					if (documentSymbol.key.toLowerCase() == "pin_to_sibling" && value && documentSymbol.valueRange) {
						if (!elementReferences.hasOwnProperty(value)) {
							elementReferences[value] = { references: [] }
						}
						elementReferences[value].references.push({
							uri: params.textDocument.uri,
							range: documentSymbol.valueRange
						})
					}
					else if (documentSymbol.children) {
						elementReferences[documentSymbol.key.toLowerCase()] = {
							range: documentSymbol.keyRange,
							references: []
						}
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
			connection.console.log(e.message)
			return null
		}
	}
	return null
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
					newText: VDF.stringify(VDF.parse(document.getText()), {
						indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
						tabSize: params.options.tabSize
					})
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

documents.listen(connection)
connection.listen()
