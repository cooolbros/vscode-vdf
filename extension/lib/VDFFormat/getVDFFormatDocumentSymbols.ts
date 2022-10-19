import { EndOfStreamError } from "$lib/VDF/VDFErrors"
import { VDFParserTools } from "$lib/VDF/VDFParserTools"
import { VDFPosition } from "$lib/VDF/VDFPosition"
import { VDFRange } from "$lib/VDF/VDFRange"
import { VDFTokeniser } from "$lib/VDF/VDFTokeniser"
import { VDFFormatDocumentSymbol } from "./VDFFormatDocumentSymbol"
import { InvalidTokenSequenceError } from "./VDFFormatErrors"
import { VDFFormatTokeniser } from "./VDFFormatTokeniser"

export function getVDFFormatDocumentSymbols(str: string): VDFFormatDocumentSymbol[] {

	const tokeniser = new VDFFormatTokeniser(str)

	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {

		const documentSymbols: VDFFormatDocumentSymbol[] = []

		const objectTerminator = isObject ? "}" : null
		while (true) {

			const currentToken = tokeniser.next(false, true)

			if (currentToken == objectTerminator) {
				break
			}
			if (currentToken == null) {
				throw new EndOfStreamError("key", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			const documentSymbol: VDFFormatDocumentSymbol = {}

			if (VDFParserTools.is.comment(currentToken)) {
				// Block comment
				documentSymbol.blockComment = VDFParserTools.convert.comment(currentToken)
			}
			else {
				if (VDFTokeniser.whiteSpaceTokenTerminate.has(currentToken)) {
					throw new InvalidTokenSequenceError(currentToken)
				}
				documentSymbol.key = VDFParserTools.convert.token(currentToken)[0]
				let value = tokeniser.next(false, true)

				if (value == null) {
					throw new EndOfStreamError("value", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}

				if (VDFParserTools.is.comment(value)) {
					documentSymbol.inLineComment = VDFParserTools.convert.comment(value)
					value = tokeniser.next(false, true)
					if (value == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						throw new InvalidTokenSequenceError(documentSymbol.key, documentSymbol.inLineComment, `${value}`)
					}
				}
				else if (VDFParserTools.is.conditional(value)) {
					documentSymbol.conditional = value
					value = tokeniser.next(false, true)
					if (value == null) {
						throw new EndOfStreamError("value", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
					}
					if (VDFParserTools.is.comment(value)) {
						documentSymbol.inLineComment = VDFParserTools.convert.comment(value)
						value = tokeniser.next(false, true)

						if (value == null) {
							throw new Error("\"{\" required after conditional + comment sequence")
						}

						if (value == "{") {
							documentSymbol.value = parseObject(documentSymbol.key, true)
						}
						else {
							throw new InvalidTokenSequenceError(documentSymbol.key, documentSymbol.conditional, documentSymbol.inLineComment, value)
						}
					}
					else if (value == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						documentSymbol.value = VDFParserTools.convert.token(value)[0]
					}
				}
				else if (value == "{") {
					documentSymbol.value = parseObject(documentSymbol.key, true)
				}
				else {
					if (value == null || VDFTokeniser.whiteSpaceTokenTerminate.has(value)) {
						throw new InvalidTokenSequenceError(documentSymbol.key, value)
					}
					documentSymbol.value = VDFParserTools.convert.token(value)[0]
					let lookAhead = tokeniser.next(true, false)

					if (lookAhead != null) {
						if (VDFParserTools.is.comment(lookAhead)) {
							documentSymbol.inLineComment = VDFParserTools.convert.comment(lookAhead)
							tokeniser.next() // Skip comment
						}
						else if (VDFParserTools.is.conditional(lookAhead)) {
							documentSymbol.conditional = lookAhead
							tokeniser.next(false, true)	// Skip OS Tag
							lookAhead = tokeniser.next(true, false)
							if (lookAhead != null && VDFParserTools.is.comment(lookAhead)) {
								documentSymbol.inLineComment = VDFParserTools.convert.comment(lookAhead)
								tokeniser.next()
							}
						}
					}
				}
			}

			documentSymbols.push(documentSymbol)
		}

		return documentSymbols
	}

	return parseObject("document", false)
}

