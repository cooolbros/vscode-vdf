import fs, { existsSync } from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL, URL } from "url"
import { TextDocument } from "vscode-languageserver-textdocument"
import { CompletionItem, CompletionItemKind, Definition, DocumentSymbol, Position, Range, SymbolKind } from "vscode-languageserver/node"
import { VDF, VDFOSTags, VDFSyntaxError, VDFTokeniser, VDFTokeniserOptions } from "../../vdf"

export interface VSCodeVDFSettings {
	readonly teamFortess2Folder: string
	readonly hudAnimationsExtraTabs: number
	readonly referencesCodeLens: {
		readonly showOnAllElements: boolean
		readonly showOnAllEvents: boolean
	}
	readonly autoCompletionKind: "incremental" | "all"
}

/**
 * Recursive merge all properties from one object into another
 * @param obj1 First Object
 * @param obj2 Second Object
 */
export function merge(obj1: any, obj2: any): any {
	for (let i in obj1) {
		if (typeof obj1[i] === "object") {
			if (obj2.hasOwnProperty(i) && typeof obj2[i] == "object") {
				merge(obj1[i], obj2[i])
			}
		}
		else {
			if (obj2.hasOwnProperty(i)) {
				obj1[i] = obj2[i]
			}
		}
	}
	for (let j in obj2) {
		// check if property exists because we dont want to shallow merge an object
		if (!obj1.hasOwnProperty(j)) {
			obj1[j] = obj2[j]
		}
	}
	return obj1
}

/**
 * Resolve root folder of an absolute HUD file path
 * @param uri File uri containing object.
 * @returns The root of the HUD folder as a file path string (`C:/...`)
 */
export function getHUDRoot({ uri }: { uri: string }): string | null {
	let folderPath = fileURLToPath(uri)
	while (folderPath != `${new URL(folderPath).protocol}\\`) {
		if (fs.existsSync(`${folderPath}/info.vdf`)) {
			return folderPath
		}
		folderPath = path.dirname(folderPath)
	}
	return null
}

/**
 * Load all key/values from a .res file (include #base files)
 * @description This function will load all controls in .res files and does not match the behaviour of TF2 .res loading
 * @param filePath .res path
 */
export function loadAllControls(filePath: string): any {
	const origin: object = {}
	const addControls = (filePath: string) => {
		const obj = fs.existsSync(filePath) ? VDF.parse(fs.readFileSync(filePath, "utf-8")) : {}
		if (obj.hasOwnProperty("#base")) {
			const baseFiles: string[] = Array.isArray(obj["#base"]) ? obj["#base"] : [obj["#base"]]
			const folder = path.dirname(filePath)
			for (const baseFile of baseFiles) {
				addControls(`${folder}/${baseFile}`)
			}
		}
		merge(origin, obj)
	}
	addControls(filePath)
	return origin
}
export interface VDFDocumentSymbol extends DocumentSymbol {
	name: string
	nameRange: Range
	value?: string
	valueRange?: Range,
	children?: VDFDocumentSymbol[]
}

export function getVDFDocumentSymbols(str: string, options?: VDFTokeniserOptions): VDFDocumentSymbol[] {
	const tokeniser = new VDFTokeniser(str, options)
	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbol[] => {
		// When throwing syntax errors here use VDFSyntaxError or the language server will think it is a real error

		const documentSymbols: VDFDocumentSymbol[] = []

		let key = tokeniser.next()
		let keyRange = Range.create(tokeniser.line, tokeniser.character - tokeniser.quoted - key.length, tokeniser.line, tokeniser.character - tokeniser.quoted)

		let value = tokeniser.next(true)
		// Don't calculate valueRange because the next token could indicate that the value is an object

		const objectTerminator = obj ? "}" : "EOF"

		while (key != objectTerminator) {

			if (value.startsWith("[") && value.endsWith("]") && (tokeniser.options.osTags == VDFOSTags.Objects || tokeniser.options.osTags == VDFOSTags.All)) {
				key += ` ${tokeniser.next()}`
				tokeniser.next() // Skip opening brace

				const children = parseObject(true)

				const endPosition = Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted)
				const selectionRange = Range.create(keyRange.start, endPosition)

				documentSymbols.push({
					name: key,
					nameRange: keyRange,
					range: selectionRange,
					selectionRange: selectionRange,
					children: children,
					kind: SymbolKind.Object
				})
			}
			else if (value == "{") {
				tokeniser.next() // Skip opening brace
				const children = parseObject(true)

				const endPosition = Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted)
				const selectionRange = Range.create(keyRange.start, endPosition)

				documentSymbols.push({
					name: key,
					nameRange: keyRange,
					range: selectionRange,
					selectionRange: selectionRange,
					children: children,
					kind: SymbolKind.Object
				})
			}
			else {
				value = tokeniser.next()

				if (value == objectTerminator) {
					throw new VDFSyntaxError(`Value expected for "${key}"!`, keyRange)
				}

				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]") && (tokeniser.options.osTags == VDFOSTags.Strings || tokeniser.options.osTags == VDFOSTags.All)) {
					key += ` ${tokeniser.next()}`
				}

				const valueRange = Range.create(Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted - value.length), Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted))

				const containingRange = Range.create(keyRange.start, valueRange.end)


				documentSymbols.push({
					name: key,
					nameRange: keyRange,
					range: containingRange,
					selectionRange: containingRange,
					value: value,
					detail: value,
					valueRange: valueRange,
					kind: SymbolKind.String
				})
			}

			key = tokeniser.next()
			if (key != objectTerminator) {
				keyRange = Range.create(tokeniser.line, tokeniser.character - tokeniser.quoted - key.length, tokeniser.line, tokeniser.character - tokeniser.quoted)
			}
			value = tokeniser.next(true)
		}
		return documentSymbols
	}
	return parseObject(false)
}

/**
* Search a HUD file for a specified key/value pair
* @param uri Uri path to file
* @param str fileContents or file DocumentSymbol[]
* @param key key name to search for.
* @param value value to search for (Optional)
* @param parentKeyConstraint
* @returns The file uri (starting with file:///), line and character of the specified key (or null if the key is not found)
*/
export function getLocationOfKey(uri: string, str: string | VDFDocumentSymbol[], key: string, value?: string, parentKeyConstraint?: string): Definition | null {
	const searchFile = (filePath: string, documentSymbols: VDFDocumentSymbol[]) => {
		const objectPath: string[] = []
		const search = (documentSymbols: VDFDocumentSymbol[]): Definition | null => {
			for (const documentSymbol of documentSymbols) {
				objectPath.push(documentSymbol.name.toLowerCase())
				const currentKey: string = documentSymbol.name.toLowerCase()
				if (currentKey == "#base") {
					const baseFilePath = `${path.dirname(filePath)}/${documentSymbol.detail}`
					if (fs.existsSync(baseFilePath)) {
						const result = searchFile(baseFilePath, getVDFDocumentSymbols(fs.readFileSync(baseFilePath, "utf-8")))
						if (result) {
							return result
						}
					}
				}
				if (currentKey == key && (value ? documentSymbol.detail == value : true) && (parentKeyConstraint ? objectPath.includes(parentKeyConstraint.toLowerCase()) : true)) {
					return {
						uri: pathToFileURL(filePath).href,
						range: documentSymbol.nameRange
					}
				}
				if (documentSymbol.children) {
					const result = search(documentSymbol.children)
					if (result) {
						return result
					}
				}
				objectPath.pop()
			}
			return null
		}
		return search(documentSymbols)
	}

	uri = uri.startsWith("file:///") ? fileURLToPath(uri) : uri
	str = typeof str == "string" ? getVDFDocumentSymbols(str) : str
	key = key.toLowerCase()

	return searchFile(uri, str)
}

/**
 *
 * @param str Document contents or VDF Document Symbols (VDFDocumentSymbol[])
 * @param position Position to document symbol at
 * @returns
 */
export function getDocumentSymbolsAtPosition(str: string | VDFDocumentSymbol[], position: Position): VDFDocumentSymbol[] | null {
	const search = (documentSymbols: VDFDocumentSymbol[]): VDFDocumentSymbol[] | null => {
		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.children) {
				const result = search(documentSymbol.children)
				if (result) {
					return result
				}
			}
			if (position.line >= documentSymbol.nameRange.start.line) {
				return documentSymbols
			}
		}
		return null
	}
	str = typeof str == "string" ? getVDFDocumentSymbols(str) : str
	return search(str)
}


const sectionIcons = {
	"Colors": CompletionItemKind.Color,
	"Borders": CompletionItemKind.Snippet,
	"Fonts": CompletionItemKind.Text,
}

export function clientschemeValues(document: TextDocument, section: "Colors" | "Borders" | "Fonts"): CompletionItem[] {
	const hudRoot = getHUDRoot(document)
	if (hudRoot == null) {
		return []
	}

	const clientschemePath = `${hudRoot}/resource/clientscheme.res`
	let hudclientscheme: any

	if (existsSync(clientschemePath)) {
		hudclientscheme = loadAllControls(clientschemePath)
		return Object.entries(hudclientscheme["Scheme"][section]).map(([key, value]: [string, any]) => {
			switch (section) {
				case "Colors": {
					let colourValue: string = value
					while (/[^\s\d]/.test(colourValue) && colourValue != undefined) {
						colourValue = <string>hudclientscheme["Scheme"]["Colors"][colourValue]
					}

					let colours: number[] = colourValue.split(/\s+/).map(parseFloat)

					const r = colours[0].toString(16)
					const g = colours[1].toString(16)
					const b = colours[2].toString(16)
					const a = (colours[3] * 255).toString(16)

					const hex = `#${r.length == 1 ? `0${r}` : r}${g.length == 1 ? `0${g}` : g}${b.length == 1 ? `0${b}` : b}`
					return {
						label: key,
						kind: sectionIcons[section],
						documentation: hex
					}
				}
				case "Borders": {
					return {
						label: key,
						kind: sectionIcons[section],
						detail: value?.bordertype == "scalable_image"
							? `[Image] ${value?.image ?? ""}${value?.image && value?.color ? " " : ""}${value?.color ?? ""} `
							: ((): string => {
								const firstBorderSideKey = Object.keys(value).find(i => typeof value[i] == "object")
								if (firstBorderSideKey) {
									const firstBorderSide = value[firstBorderSideKey]
									const thickness = Object.keys(firstBorderSide).length
									const colour: string = firstBorderSide[Object.keys(firstBorderSide)[0]].color
									return `[Line] ${thickness}px ${/\s/.test(colour) ? `"${colour}"` : colour} `
								}
								return ""
							})()
					}
				}
				case "Fonts": {
					return {
						label: key,
						kind: sectionIcons[section],
						detail: `${value["1"]?.name ?? ""}${value?.["1"]?.name && value?.["1"]?.tall ? " " : ""}${value["1"]?.tall ?? ""}`
					}
				}
			}
		})
	}

	return []
}

export function getCodeLensTitle(references: number): string {
	return `${references} reference${references == 1 ? "" : "s"}`
}

export function RangecontainsPosition(range: Range, position: Position): boolean {
	return range.start.line <= position.line && range.end.line >= position.line
}

export function RangecontainsRange(range: Range, { start, end }: Range): boolean {
	return RangecontainsPosition(range, start) && RangecontainsPosition(range, end)
}
