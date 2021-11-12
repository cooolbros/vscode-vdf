import { ColorInformation, DocumentSymbol, Position, Range } from "vscode-languageserver/node";
import { getVDFDocumentSymbols, RangecontainsPosition } from "../../../shared/tools";
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

					const lookahead: string = tokeniser.next(true)
					if (lookahead.startsWith("[") && lookahead.endsWith("]")) {
						currentToken += `${VDFExtended.OSTagDelimeter}${tokeniser.next()}`;
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
		getObjectAtPosition: (str: string | DocumentSymbol[], position: Position): DocumentSymbol[] | null => {
			const search = (documentSymbols: DocumentSymbol[]): DocumentSymbol[] | null => {
				for (const documentSymbol of documentSymbols) {
					if (RangecontainsPosition(documentSymbol.range, position)) {
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
		}
	}
}
