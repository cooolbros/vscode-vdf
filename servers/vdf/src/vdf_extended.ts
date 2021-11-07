import { CodeLens, ColorInformation, DocumentSymbol, Position, Range, _Connection } from "vscode-languageserver/node";
import { getVDFDocumentSymbols } from "../../../shared/tools";
import { VDFTokeniser } from "../../../shared/vdf";

export class VDFExtended {
	static OSTagDelimeter: string = "^"

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
			str = typeof str == "string" ? getVDFDocumentSymbols(str) : str
			return search(str)
		},

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
							title: `${references.length} reference${references.length > 1 ? "s" : ""}`,
							command: "vscode-vdf.showReferences",
							arguments: [
								Position.create(range.start.line, range.start.character)
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


}
