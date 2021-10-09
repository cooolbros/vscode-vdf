import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL, URL } from "url";
import { CodeLens, ColorInformation, DocumentSymbol, Location, Position, Range, TextEdit, _Connection } from "vscode-languageserver/node";
import { VDFTokeniser } from "./vdf_tokeniser";

export type VDFDocument = Array<[number, number, string, string | VDFDocument]>

export function VDFSearch(uri: URL, document: VDFDocument, query: string, connection: _Connection): Location | undefined {

	const search = (uri: URL, document: VDFDocument): Location | undefined => {
		// connection.console.log(`[VDFSearch] Searching ${uri.pathname}`)
		for (const [line, character, key, value] of document) {
			// connection.console.log(`${key}: ${value}`)
			if (key.toLowerCase() == "#base") {
				const baseFileUri: URL = pathToFileURL(`${path.dirname(fileURLToPath(uri))}/${value}`)
				// connection.console.log(`going to search ${baseFileUri}`)
				const result = search(baseFileUri, VDFExtended.getDocumentObjects(fs.readFileSync(baseFileUri, "utf-8"), connection))
				if (result) {
					return result
				}
			}
			if (key.toLowerCase() == query.toLowerCase()) {
				// connection.console.log(`Found matching item for ${query}, Checking type`)
				return Location.create(uri.href, Range.create(Position.create(line, character - 1), Position.create(line, character + key.length - 1)))
			}
			if (Array.isArray(value)) {
				// connection.console.log(`Iterating ${key}`)
				const range: Location | undefined = search(uri, value)
				if (range) {
					return range
				}
			}
		}
	}

	return search(uri, document)
}

export class VDFExtended {
	static OSTagDelimeter: string = "^"

	static getDocumentObjects(str: string, connection: _Connection): VDFDocument {
		// connection.console.log(str)
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): VDFDocument => {
			const obj: VDFDocument = []
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					tokeniser.next(); // Skip over opening brace
					obj.push([tokeniser.line, tokeniser.character, currentToken, parseObject()]);
				}
				else if (nextToken == "{") {
					// Object
					const line = tokeniser.line
					const character = tokeniser.character
					tokeniser.next(); // Skip over opening brace
					obj.push([line, character - currentToken.length, currentToken, parseObject()]);
				}
				else {
					// Primitive
					const line = tokeniser.line
					const character = tokeniser.character
					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					}

					if (nextToken == "}") {
						throw {
							message: `Missing value for "${currentToken}"`,
							line: tokeniser.line,
							character: tokeniser.character
						}
					}

					obj.push([line, character - currentToken.length, currentToken, nextToken]);
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return obj;
		}
		return parseObject();
	}


	static getColours(str: string): ColorInformation[] {
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): ColorInformation[] => {
			const obj: { [key: string]: any } = {}
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
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						if (Array.isArray(value)) {
							// Object list exists
							// obj[currentToken].push(parseObject());
							colours.push(...parseObject())
						}
						else {
							// Object already exists
							// obj[currentToken] = [value, parseObject()]
							colours.push(...parseObject())
						}
					}
					else {
						// Object doesnt exist
						// obj[currentToken] = parseObject();
						colours.push(...parseObject())
					}
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
							range: {
								// The tokeniser skips over the last closing brace, subtract 1 to stay inside
								start: {
									line: tokeniser.line,
									character: tokeniser.character - nextToken.length - 1
								},
								end: {
									line: tokeniser.line,
									character: tokeniser.character - 1
								}
							}
						})
					}

					// if (obj.hasOwnProperty(currentToken)) {
					// 	const value = obj[currentToken]
					// 	// dynamic property exists
					// 	if (Array.isArray(value)) {
					// 		// Array already exists
					// 		obj[currentToken].push(nextToken);
					// 	}
					// 	else {
					// 		// Primitive type already exists
					// 		obj[currentToken] = [value, nextToken]
					// 	}
					// }
					// else {
					// 	// Property doesn't exist
					// 	obj[currentToken] = nextToken;
					// }
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return colours;
		}
		return parseObject();
	}
	static renameToken(str: string, oldName: string, newName: string, uri?: string): { [uri: string]: TextEdit[] } {
		const tokeniser = new VDFTokeniser(str)
		const result: { [uri: string]: TextEdit[] } = {}
		const parseObject = (): { [key: string]: any } => {
			const obj: { [key: string]: any } = {}
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					tokeniser.next(); // Skip over opening brace
					obj[currentToken] = parseObject();
				}
				else if (nextToken == "{") {
					// Object
					tokeniser.next(); // Skip over opening brace
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						if (Array.isArray(value)) {
							// Object list exists
							obj[currentToken].push(parseObject());
						}
						else {
							// Object already exists
							obj[currentToken] = [value, parseObject()]
						}
					}
					else {
						// Object doesnt exist
						obj[currentToken] = parseObject();
					}
				}
				else {
					// Primitive
					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
					}
					if (obj.hasOwnProperty(currentToken)) {
						const value = obj[currentToken]
						// dynamic property exists
						if (Array.isArray(value)) {
							// Array already exists
							obj[currentToken].push(nextToken);
						}
						else {
							// Primitive type already exists
							obj[currentToken] = [value, nextToken]
						}
					}
					else {
						// Property doesn't exist
						obj[currentToken] = nextToken;
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return obj;
		}
		parseObject();
		return result
	}

	static getObjectAtOffset(document: VDFDocument, position: Position, connection: _Connection): VDFDocument | undefined {
		const search = (doc: VDFDocument): VDFDocument | undefined => {
			for (const [line, character, key, value] of doc) {
				if (line >= position.line - 1) {
					return doc
				}
				if (Array.isArray(value)) {
					const doc = search(value)
					if (doc) {
						return doc
					}
				}
			}
		}
		return search(document)
	}

	static getDocumentSymbols(str: string): DocumentSymbol[] {
		const tokeniser = new VDFTokeniser(str)
		const parseObject = (): DocumentSymbol[] => {
			const locations: DocumentSymbol[] = []
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					const line = tokeniser.line
					const character = tokeniser.character

					currentToken += ` ${tokeniser.next()}`; // Skip over OS Tag
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
						start: Position.create(line, character - currentToken.length),
						end: Position.create(line, character)
					}

					locations.push({
						name: currentToken,
						kind: 19,
						range: range,
						selectionRange: range,
						children: parseObject()
					});
				}
				else {
					// Primitive

					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						tokeniser.next()
					}

					if (nextToken == "}") {
						throw {
							message: `Missing value for "${currentToken}"`,
							line: tokeniser.line,
							character: tokeniser.character
						}
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
			return locations;
		}
		return parseObject();
	}

	static getCodeLens(uri: string, str: string, connection: _Connection): CodeLens[] {
		const elementReferences: Record<string, [CodeLens[], Range?]> = {}
		const tokeniser = new VDFTokeniser(str)

		const parseObject = () => {
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag

					if (!elementReferences.hasOwnProperty(currentToken)) {
						elementReferences[currentToken] = [[], {
							start: Position.create(tokeniser.line, tokeniser.character),
							end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
						}]
					}
					elementReferences[currentToken][1] = {
						start: Position.create(tokeniser.line, tokeniser.character),
						end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
					}

					tokeniser.next(); // Skip over OS Tag
					tokeniser.next(); // Skip over opening brace
				}
				else if (nextToken == "{") {
					// Object


					if (!elementReferences.hasOwnProperty(currentToken)) {
						elementReferences[currentToken] = [[], {
							start: Position.create(tokeniser.line, tokeniser.character),
							end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
						}]
					}
					elementReferences[currentToken][1] = {
						start: Position.create(tokeniser.line, tokeniser.character),
						end: Position.create(tokeniser.line, tokeniser.character + currentToken.length)
					}

					tokeniser.next(); // Skip over opening brace

					parseObject()
				}
				else {
					// Primitive

					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						tokeniser.next()
					}

					if (currentToken.toLowerCase() == "pin_to_sibling") {
						if (!elementReferences.hasOwnProperty(nextToken)) {
							elementReferences[nextToken] = [[], undefined]
						}

						elementReferences[nextToken][0].push({
							range: {
								start: Position.create(tokeniser.line, tokeniser.character - nextToken.length),
								end: Position.create(tokeniser.line, tokeniser.character)
							}
						})
					}

					if (nextToken == "}") {
						throw {
							message: `Missing value for "${currentToken}"`,
							line: tokeniser.line,
							character: tokeniser.character
						}
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
		}

		parseObject()

		const codelenss: CodeLens[] = []
		for (const property in elementReferences) {

			const [references, range] = elementReferences[property]
			if (references.length > 0) {
				if (range != undefined) {
					codelenss.push({
						range: range,
						command: {
							title: `${references.length} references`,
							command: "vscode-vdf.show-references",
							arguments: [
								uri,
								range.start
							]
						}
					})
				}
				// else {
				// 	connection.sendDiagnostics({
				// 		uri: uri,
				// 		diagnostics: [
				// 			{
				// 				message: `Cannot find name ${property}`,
				// 				range: {
				// 					start: Position.create(0, 0),
				// 					end: Position.create(0, 10)
				// 				}
				// 			}
				// 		]
				// 	})
				// }
			}
			else {
				// connection.console.log(`${property} has no references`)
			}
		}

		return codelenss
	}

	static getElementReferences(uri: string, str: string, elementName: string): Location[] {
		elementName = elementName.toLowerCase()
		const locations: Location[] = []
		const tokeniser = new VDFTokeniser(str)
		const parseObject = () => {
			let currentToken = tokeniser.next();
			let nextToken = tokeniser.next(true);
			while (currentToken != "}" && nextToken != "EOF") {
				const lookahead: string = tokeniser.next(true)
				if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
					// Object with OS Tag
					const line = tokeniser.line
					const character = tokeniser.character

					currentToken += ` ${tokeniser.next()}`; // Skip over OS Tag
					tokeniser.next(); // Skip over opening brace

					const range: Range = {
						start: Position.create(line, character),
						end: Position.create(line, character + currentToken.length)
					}


				}
				else if (nextToken == "{") {
					// Object
					tokeniser.next(); // Skip over opening brace
					parseObject()
				}
				else {
					// Primitive

					tokeniser.next(); // Skip over value
					// Check primitive os tag
					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						tokeniser.next()
					}

					if (currentToken.toLowerCase() == "pin_to_sibling" && nextToken.toLowerCase() == elementName) {
						locations.push({
							uri: uri,
							range: {
								start: Position.create(tokeniser.line, tokeniser.character - nextToken.length - 1),
								end: Position.create(tokeniser.line, tokeniser.character - 1)
							}
						})
					}

					if (nextToken == "}") {
						throw {
							message: `Missing value for "${currentToken}"`,
							line: tokeniser.line,
							character: tokeniser.character
						}
					}
				}
				currentToken = tokeniser.next();
				nextToken = tokeniser.next(true);
			}
		}
		parseObject()


		return locations
	}
}