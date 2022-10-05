import fs, { existsSync } from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL, URL } from "url"
import { TextDocument } from "vscode-languageserver-textdocument"
import { CompletionItem, CompletionItemKind, Definition, Range } from "vscode-languageserver/node"
import { VDF } from "../../VDF"
import { getVDFDocumentSymbols, VDFDocumentSymbol } from "../../VDF/dist/getVDFDocumentSymbols"

/**
 * Recursive merge all properties from one object into another
 * @param obj1 First Object
 * @param obj2 Second Object
 */
export function merge(obj1: any, obj2: any): any {
	for (const i in obj1) {
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
	for (const j in obj2) {
		// check if property exists because we dont want to shallow merge an object
		if (!obj1.hasOwnProperty(j)) {
			obj1[j] = obj2[j]
		}
	}
	return obj1
}

export type HUDRoot = string | 0

/**
 * Resolve root folder of an absolute HUD file path
 * @param uri File uri containing object.
 * @returns The root of the HUD folder as a file path string (`C:/...`) or 0 if the HUD root directory is not found
 */
export function getHUDRoot({ uri }: { uri: string }): HUDRoot {

	const filePath = (<T extends string>(str: string, search: T): str is `${T}${string}` => str.startsWith(search))(uri, "git:/")
		? gitUriToFilePath(uri)
		: fileURLToPath(uri)

	let folderPath = path.dirname(filePath)
	let folderPathReference = filePath

	while (folderPath != folderPathReference) {
		if (fs.existsSync(path.join(folderPath, "info.vdf"))) {
			return folderPath
		}
		folderPath = path.dirname(folderPath)
		folderPathReference = path.dirname(folderPathReference)
	}

	return 0
}

export function gitUriToFilePath(uri: `git:/${string}`): string {
	return JSON.parse(new URL(uri).searchParams.keys().next().value)["path"]
}

/**
 * Load all key/values from a .res file (include #base files)
 * @description This function will load all controls in .res files and does not match the behaviour of TF2 .res loading
 * @param filePath .res path
 */
export function loadAllControls(filePath: string): any {
	const origin: object = {}

	const filterString = (value: unknown): value is string => typeof value == "string"

	const addControls = (filePath: string) => {
		const obj = fs.existsSync(filePath) ? VDF.parse(fs.readFileSync(filePath, "utf-8")) : {}
		if (obj.hasOwnProperty("#base")) {
			const baseFiles: string[] = Array.isArray(obj["#base"]) ? obj["#base"].filter(filterString) : [...Object.values(obj["#base"]).filter(filterString)]
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

const sectionIcons = {
	"Colors": CompletionItemKind.Color,
	"Borders": CompletionItemKind.Snippet,
	"Fonts": CompletionItemKind.Text,
}

export function clientschemeValues(document: TextDocument, section: keyof typeof sectionIcons): CompletionItem[] {
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

					const colours: number[] = colourValue.split(/\s+/).map(parseFloat)

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



export function getLineRange(line: number): Range {
	return {
		start: {
			line: line,
			character: 0
		},
		end: {
			line: line,
			character: Infinity
		}
	}
}
