import { EndOfStreamError, UnexpectedTokenError } from "$lib/VDF/VDFErrors"
import { VDFParserTools } from "$lib/VDF/VDFParserTools"
import { VDFPosition } from "$lib/VDF/VDFPosition"
import { VDFRange } from "$lib/VDF/VDFRange"
import { VDFTokeniser } from "$lib/VDF/VDFTokeniser"
import { SymbolKind } from "vscode-languageserver"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"

export function getVDFDocumentSymbols(str: string): VDFDocumentSymbols {
	const tokeniser = new VDFTokeniser(str)

	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbols => {

		const documentSymbols: VDFDocumentSymbols = new VDFDocumentSymbols()

		const objectTerminator = obj ? "}" : null
		while (true) {

			const keyToken = tokeniser.next()

			if (keyToken == objectTerminator) {
				break
			}
			if (keyToken == null) {
				throw new EndOfStreamError("key", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}
			if (VDFTokeniser.whiteSpaceTokenTerminate.has(keyToken)) {
				throw new UnexpectedTokenError(`"${keyToken}"`, "key", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - 1), new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			const startPosition = new VDFPosition(tokeniser.line, tokeniser.character - keyToken.length)
			const nameRange = new VDFRange(startPosition, new VDFPosition(tokeniser.line, tokeniser.character))

			const valueToken = tokeniser.next()

			if (valueToken == null) {
				throw new UnexpectedTokenError("EOF", "token", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}
			if (VDFTokeniser.whiteSpaceTokenTerminate.has(keyToken)) {
				throw new UnexpectedTokenError(`"${keyToken}"`, "value", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - 1), new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			let conditional: `[${string}]` | undefined
			let children: VDFDocumentSymbols | undefined
			let detail: [string, 0 | 1] | undefined
			let detailRange: VDFRange | undefined

			if (valueToken == "{") {
				children = parseObject(true)
			}
			else if (VDFParserTools.is.conditional(valueToken)) {
				conditional = valueToken

				const value = tokeniser.next()
				if (value == null) {
					throw new UnexpectedTokenError("EOF", "token", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}
				// if (VDFTokeniser.whiteSpaceTokenTerminate.has(value)) {
				// 	throw new UnexpectedTokenError(`"${value}"`, "value", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - 1), new VDFPosition(tokeniser.line, tokeniser.character)))
				// }

				if (value == null) {
					throw new UnexpectedTokenError("EOF", "\"{\"", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}

				if (value == "{") {
					// Object
					children = parseObject(true)
				}
				else {
					// String
					detail = VDFParserTools.convert.token(value)
					detailRange = new VDFRange(
						new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detail[1]),
						new VDFPosition(tokeniser.line, tokeniser.character - detail[1])
					)

					const conditional2 = tokeniser.next(true)
					if (conditional2 != null && VDFParserTools.is.conditional(conditional2)) {
						conditional = conditional2
						tokeniser.next() // Skip OS Tag
					}
				}
			}
			else {
				// String
				detail = VDFParserTools.convert.token(valueToken)
				detailRange = new VDFRange(
					new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detail[1]),
					new VDFPosition(tokeniser.line, tokeniser.character - detail[1])
				)

				// Conditional
				const lookAhead = tokeniser.next(true)
				if (lookAhead != null && VDFParserTools.is.conditional(lookAhead)) {
					conditional = lookAhead
					tokeniser.next()
				}
			}

			const endPosition = new VDFPosition(tokeniser.line, tokeniser.character)
			const selectionRange = new VDFRange(startPosition, endPosition)

			documentSymbols.push(new VDFDocumentSymbol(
				VDFParserTools.convert.token(keyToken)[0],
				nameRange,
				children != undefined ? SymbolKind.Object : SymbolKind.String,
				conditional ?? null,
				selectionRange,
				detail ? { detail: detail[0], range: detailRange!, quoted: detail[1] == 1 } : children!,
			))
		}

		return documentSymbols

	}
	return parseObject(false)
}
