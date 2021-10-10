import * as fs from "fs";
import * as path from "path";
import { ColorInformation, Definition, DocumentSymbol, Position, Range, SymbolKind } from "vscode-languageserver/node";
import { VDFOSTags, VDFSyntaxError, VDFTokeniser, VDFTokeniserOptions } from "./vdf_tokeniser";

export class VDFExtended {
	static OSTagDelimeter: string = "^"

	static getDocumentSymbols(str: string, options?: VDFTokeniserOptions): DocumentSymbol[] {
		const tokeniser = new VDFTokeniser(str, options)
		const parseObject = (): DocumentSymbol[] => {
			const locations: DocumentSymbol[] = []
			let currentToken = tokeniser.next();
			let currentTokenRange: Range = {
				start: Position.create(tokeniser.line, tokeniser.character - currentToken.length),
				end: Position.create(tokeniser.line, tokeniser.character),
			}
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]") && (tokeniser.options.osTags == VDFOSTags.Objects || tokeniser.options.osTags == VDFOSTags.All)) {
					// Object with OS Tag
					const line = tokeniser.line
					const character = tokeniser.character

					currentToken += `${tokeniser.next()}`; // Skip over OS Tag
					tokeniser.next(); // Skip over opening brace

					const range: Range = {
						start: Position.create(line, character),
						end: Position.create(line, character + currentToken.length)
					}

					locations.push({
						name: currentToken,
						kind: 19,
						range: range,
						selectionRange: range,
						children: parseObject()
					})
				}
				else if (nextToken == "{") {
					// Object
					const line = tokeniser.line
					const character = tokeniser.character
					tokeniser.next(); // Skip over opening brace

					const range: Range = {
						start: Position.create(line, character - currentToken.length - tokeniser.quoted - 1),
						end: Position.create(line, character - tokeniser.quoted - 1)
					}

					locations.push({
						name: currentToken,
						kind: SymbolKind.Object,
						range: range,
						selectionRange: range,
						children: parseObject()
					});
				}
				else {
					// Primitive
					locations.push({
						name: currentToken,
						detail: nextToken,
						kind: SymbolKind.String,
						range: currentTokenRange,
						selectionRange: currentTokenRange,
					});

					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]") && (tokeniser.options.osTags == VDFOSTags.Strings || tokeniser.options.osTags == VDFOSTags.All)) {
						tokeniser.next()
					}

					if (nextToken == "}") {
						throw new VDFSyntaxError(`Missing value for "${currentToken}"`, tokeniser.line, tokeniser.character)
					}
				}
				currentToken = tokeniser.next();
				currentTokenRange = {
					start: Position.create(tokeniser.line, tokeniser.character - currentToken.length - tokeniser.quoted),
					end: Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted),
				}
				nextToken = tokeniser.next(true);
			}
			return locations;
		}
		return parseObject();
	}

	static getColours(str: string): ColorInformation[] {
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): ColorInformation[] => {
			const colours: ColorInformation[] = []
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					tokeniser.next(); // Skip over opening brace
					// obj[currentToken] = parseObject();
					colours.push(...parseObject())
				}
				else if (nextToken == "{") {
					// Object
					tokeniser.next(); // Skip over opening brace
					colours.push(...parseObject())
				}
				else {
					// Primitive
					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					}

					if (/\d+\s+\d+\s+\d+\s+\d+/.test(nextToken)) {
						const colour = nextToken.split(/\s+/)
						colours.push({
							color: {
								red: parseInt(colour[0]) / 255,
								green: parseInt(colour[1]) / 255,
								blue: parseInt(colour[2]) / 255,
								alpha: parseInt(colour[3]) / 255
							},
							range: Range.create(
								// The tokeniser skips over the last closing quote, subtract 1 to stay inside
								Position.create(tokeniser.line, tokeniser.character - nextToken.length - tokeniser.quoted),
								Position.create(tokeniser.line, tokeniser.character - tokeniser.quoted)
							)
						})
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return colours;
		}
		return parseObject();
	}

	static Searcher = {
		getObjectAtLocation: (str: string | DocumentSymbol[], location: Position): DocumentSymbol[] | null => {
			const search = (documentSymbols: DocumentSymbol[]): DocumentSymbol[] | null => {
				for (const documentSymbol of documentSymbols) {
					if (documentSymbol.range.start.line > location.line - 2) {
						return documentSymbols
					}
					if (documentSymbol.children) {
						const result = search(documentSymbol.children)
						if (result) {
							return result
						}
					}
				}
				return null
			}
			str = typeof str == "string" ? VDFExtended.getDocumentSymbols(str) : str
			return search(str)
		},
		getLocationOfKey: (filePath: string, str: string | DocumentSymbol[], key: string): Definition | null => {
			const searchFile = (filePath: string, documentSymbols: DocumentSymbol[]) => {
				const search = (documentSymbols: DocumentSymbol[]): Definition | null => {
					for (const documentSymbol of documentSymbols) {
						const currentKey: string = documentSymbol.name.toLowerCase()
						if (currentKey == "#base") {
							const baseFileURL = `${path.dirname(filePath)}/${documentSymbol.detail}`
							if (fs.existsSync(baseFileURL)) {
								const result = searchFile(baseFileURL, VDFExtended.getDocumentSymbols(fs.readFileSync(baseFileURL, "utf-8")))
								if (result) {
									return result
								}
							}
						}
						if (currentKey == key) {
							return {
								uri: `file:///${filePath}`,
								range: documentSymbol.range
							}
						}
						if (documentSymbol.children) {
							const result = search(documentSymbol.children)
							if (result) {
								return result
							}
						}
					}
					return null
				}
				return search(documentSymbols)
			}

			str = typeof str == "string" ? VDFExtended.getDocumentSymbols(str) : str
			key = key.toLowerCase()
			return searchFile(filePath, str)
		}
	}







	// static getCodeLens(uri: string, str: string, connection: _Connection): CodeLens[] {
	// 	const elementReferences: Record<string, [CodeLens[], Range?]> = {}
	// 	const tokeniser = new VDFTokeniser(str)

	// 	const parseObject = () => {
	// 		let currentToken = tokeniser.next();
	// 		let nextToken = tokeniser.next(true);
	// 		while (currentToken != "}" && nextToken != "EOF") {
	// 			const lookahead: string = tokeniser.next(true)
	// 			if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
	// 				// Object with OS Tag

	// 				if (!elementReferences.hasOwnProperty(currentToken)) {
	// 					elementReferences[currentToken] = [[], {
	// 						start: Position.create(tokeniser.line, tokeniser.character),
	// 						end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
	// 					}]
	// 				}
	// 				elementReferences[currentToken][1] = {
	// 					start: Position.create(tokeniser.line, tokeniser.character),
	// 					end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
	// 				}

	// 				tokeniser.next(); // Skip over OS Tag
	// 				tokeniser.next(); // Skip over opening brace
	// 			}
	// 			else if (nextToken == "{") {
	// 				// Object


	// 				if (!elementReferences.hasOwnProperty(currentToken)) {
	// 					elementReferences[currentToken] = [[], {
	// 						start: Position.create(tokeniser.line, tokeniser.character),
	// 						end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
	// 					}]
	// 				}
	// 				elementReferences[currentToken][1] = {
	// 					start: Position.create(tokeniser.line, tokeniser.character),
	// 					end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
	// 				}

	// 				tokeniser.next(); // Skip over opening brace

	// 				parseObject()
	// 			}
	// 			else {
	// 				// Primitive

	// 				tokeniser.next(); // Skip over value
	// 				// Check primitive os tag
	// 				const lookahead: string = tokeniser.next(true)
	// 				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
	// 					tokeniser.next()
	// 				}

	// 				if (currentToken.toLowerCase() == "pin_to_sibling") {
	// 					if (!elementReferences.hasOwnProperty(nextToken)) {
	// 						elementReferences[nextToken] = [[], undefined]
	// 					}

	// 					elementReferences[nextToken][0].push({
	// 						range: {
	// 							start: Position.create(tokeniser.line, tokeniser.character - nextToken.length),
	// 							end: Position.create(tokeniser.line, tokeniser.character)
	// 						}
	// 					})
	// 				}

	// 				if (nextToken == "}") {
	// 					throw {
	// 						message: `Missing value for "${currentToken}"`,
	// 						line: tokeniser.line,
	// 						character: tokeniser.character
	// 					}
	// 				}
	// 			}
	// 			currentToken = tokeniser.next();
	// 			nextToken = tokeniser.next(true);
	// 		}
	// 	}

	// 	parseObject()

	// 	const codelenss: CodeLens[] = []
	// 	for (const property in elementReferences) {

	// 		const [references, range] = elementReferences[property]
	// 		if (references.length > 0) {
	// 			if (range != undefined) {
	// 				codelenss.push({
	// 					range: range,
	// 					command: {
	// 						title: `${references.length} references`,
	// 						command: "vscode-vdf.show-references",
	// 						arguments: [
	// 							uri,
	// 							range.start
	// 						]
	// 					}
	// 				})
	// 			}
	// 			// else {
	// 			// 	connection.sendDiagnostics({
	// 			// 		uri: uri,
	// 			// 		diagnostics: [
	// 			// 			{
	// 			// 				message: `Cannot find name ${property}`,
	// 			// 				range: {
	// 			// 					start: Position.create(0, 0),
	// 			// 					end: Position.create(0, 10)
	// 			// 				}
	// 			// 			}
	// 			// 		]
	// 			// 	})
	// 			// }
	// 		}
	// 		else {
	// 			// connection.console.log(`${property} has no references`)
	// 		}
	// 	}

	// 	return codelenss
	// }

	// static getElementReferences(uri: string, str: string, elementName: string): Location[] {
	// 	elementName = elementName.toLowerCase()
	// 	const locations: Location[] = []
	// 	const tokeniser = new VDFTokeniser(str)
	// 	const parseObject = () => {
	// 		let currentToken = tokeniser.next();
	// 		let nextToken = tokeniser.next(true);
	// 		while (currentToken != "}" && nextToken != "EOF") {
	// 			const lookahead: string = tokeniser.next(true)
	// 			if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
	// 				// Object with OS Tag
	// 				const line = tokeniser.line
	// 				const character = tokeniser.character

	// 				currentToken += ` ${tokeniser.next()}`; // Skip over OS Tag
	// 				tokeniser.next(); // Skip over opening brace

	// 				const range: Range = {
	// 					start: Position.create(line, character),
	// 					end: Position.create(line, character + currentToken.length)
	// 				}


	// 			}
	// 			else if (nextToken == "{") {
	// 				// Object
	// 				tokeniser.next(); // Skip over opening brace
	// 				parseObject()
	// 			}
	// 			else {
	// 				// Primitive

	// 				tokeniser.next(); // Skip over value
	// 				// Check primitive os tag
	// 				const lookahead: string = tokeniser.next(true)
	// 				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
	// 					tokeniser.next()
	// 				}

	// 				if (currentToken.toLowerCase() == "pin_to_sibling" && nextToken.toLowerCase() == elementName) {
	// 					locations.push({
	// 						uri: uri,
	// 						range: {
	// 							start: Position.create(tokeniser.line, tokeniser.character - nextToken.length - 1),
	// 							end: Position.create(tokeniser.line, tokeniser.character - 1)
	// 						}
	// 					})
	// 				}

	// 				if (nextToken == "}") {
	// 					throw {
	// 						message: `Missing value for "${currentToken}"`,
	// 						line: tokeniser.line,
	// 						character: tokeniser.character
	// 					}
	// 				}
	// 			}
	// 			currentToken = tokeniser.next();
	// 			nextToken = tokeniser.next(true);
	// 		}
	// 	}
	// 	parseObject()


	// 	return locations
	// }
}