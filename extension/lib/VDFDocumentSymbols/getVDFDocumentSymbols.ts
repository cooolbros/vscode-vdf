import { Range, SymbolKind } from "vscode-languageserver"
import { UnexpectedTokenError } from "../VDF/VDFErrors"
import { parserTools } from "../VDF/VDFParserTools"
import { VDFPosition } from "../VDF/VDFPosition"
import { VDFRange } from "../VDF/VDFRange"
import { VDFTokeniser } from "../VDF/VDFTokeniser"
import { VDFTokeniserOptions } from "../VDF/VDFTokeniserOptions"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"

export function getVDFDocumentSymbols(str: string, options?: VDFTokeniserOptions): VDFDocumentSymbols {
	const tokeniser = new VDFTokeniser(str, options)

	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbols => {
		const documentSymbols: VDFDocumentSymbols = new VDFDocumentSymbols()

		let currentToken = tokeniser.next()
		let nextToken = tokeniser.next(true)

		const objectTerminator = obj ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const [key, keyQuoted] = parserTools.convert.token(currentToken)
			if (currentToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
				throw new UnexpectedTokenError(currentToken, "key", Range.create(tokeniser.line, tokeniser.character - 1, tokeniser.line, tokeniser.character))
			}
			const startPosition: VDFPosition = new VDFPosition(tokeniser.line, tokeniser.character - key.length - keyQuoted)
			const nameRange: VDFRange = new VDFRange(startPosition, new VDFPosition(tokeniser.line, tokeniser.character - keyQuoted))

			nextToken = tokeniser.next()

			let osTag: `[${string}]` | undefined
			let children: VDFDocumentSymbols | undefined
			let detail: string | undefined
			let detailQuoted: 0 | 1
			let detailRange: VDFRange | undefined

			if (nextToken == "{") {
				children = parseObject(true)
			}
			else if (parserTools.is.osTag(nextToken)) {
				osTag = nextToken
				const value = tokeniser.next()
				if (value == "{") {
					// Object
					children = parseObject(true)
				}
				else {
					// Primitive
					[detail, detailQuoted] = parserTools.convert.token(value)
					detailRange = new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detailQuoted), new VDFPosition(tokeniser.line, tokeniser.character - detailQuoted))

					if (value == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(detail)) {
						throw new UnexpectedTokenError(value, "value", detailRange)
					}

					const osTag2 = tokeniser.next(true)
					if (parserTools.is.osTag(osTag2)) {
						osTag = osTag2
						tokeniser.next() // Skip OS Tag
					}
				}
			}
			else {
				[detail, detailQuoted] = parserTools.convert.token(nextToken)
				detailRange = new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detailQuoted), new VDFPosition(tokeniser.line, tokeniser.character - detailQuoted))
				if (nextToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(nextToken)) {
					throw new UnexpectedTokenError(detail, "value", detailRange)
				}

				// OS Tag
				nextToken = tokeniser.next(true)
				if (parserTools.is.osTag(nextToken)) {
					osTag = nextToken
					tokeniser.next()
				}
			}

			const endPosition = new VDFPosition(tokeniser.line, tokeniser.character)
			const selectionRange = new VDFRange(startPosition, endPosition)

			documentSymbols.push(new VDFDocumentSymbol(
				key,
				nameRange,
				children != undefined ? SymbolKind.Object : SymbolKind.String,
				osTag ?? null,
				selectionRange,
				detail ?? children!,
				detailRange
			))

			currentToken = tokeniser.next()
			nextToken = tokeniser.next(true)
		}

		return documentSymbols

	}
	return parseObject(false)
}
