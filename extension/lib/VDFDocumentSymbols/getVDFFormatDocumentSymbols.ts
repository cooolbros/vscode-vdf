import { _Connection } from "vscode-languageserver"
import { VDFFormatTokeniser } from "./VDFFormatTokeniser"
import { parserTools } from "./VDFParserTools"
import { VDFTokeniser } from "./VDFTokeniser"

export interface VDFFormatDocumentSymbol {
	key?: string
	value?: string | VDFFormatDocumentSymbol[]
	osTag?: `[${string}]`
	blockComment?: string
	inLineComment?: string
}

/**
 * The formatter encountered a sequence of tokens that it cannot resolve the layout of
 */
export class InvalidTokenSequenceError extends Error {
	constructor(...tokens: string[]) {
		super(`Invalid token sequence! ("${tokens.join("\", \"")}")`)
	}
}


export function getVDFFormatDocumentSymbols(str: string, connection: _Connection): VDFFormatDocumentSymbol[] {
	const tokeniser = new VDFFormatTokeniser(str)
	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {
		const documentSymbols: VDFFormatDocumentSymbol[] = []

		// Get first real currentToken
		let currentToken = tokeniser.read({ skipNewlines: true })

		const objectTerminator = isObject ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const documentSymbol: VDFFormatDocumentSymbol = {}

			if (parserTools.is.comment(currentToken)) {
				// Block comment
				documentSymbol.blockComment = parserTools.convert.comment(currentToken)
			}
			else {
				if (currentToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
					throw new InvalidTokenSequenceError(currentToken)
				}
				documentSymbol.key = parserTools.convert.token(currentToken)[0]
				let value = tokeniser.read({ skipNewlines: true })
				if (parserTools.is.comment(value)) {
					documentSymbol.inLineComment = parserTools.convert.comment(value)
					value = tokeniser.read({ skipNewlines: true })
					if (value == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						throw new InvalidTokenSequenceError(documentSymbol.key, documentSymbol.inLineComment, value)
					}
				}
				else if (parserTools.is.osTag(value)) {
					documentSymbol.osTag = value
					value = tokeniser.read({ skipNewlines: true })
					if (parserTools.is.comment(value)) {
						documentSymbol.inLineComment = parserTools.convert.comment(value)
						value = tokeniser.read({ skipNewlines: true })
						if (value == "{") {
							documentSymbol.value = parseObject(documentSymbol.key, true)
						}
						else {
							throw new InvalidTokenSequenceError(documentSymbol.key, documentSymbol.osTag, documentSymbol.inLineComment, value)
						}
					}
					else if (value == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						documentSymbol.value = parserTools.convert.token(value)[0]
					}
				}
				else if (value == "{") {
					documentSymbol.value = parseObject(documentSymbol.key, true)
				}
				else {
					if (value == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(value)) {
						throw new InvalidTokenSequenceError(documentSymbol.key, value)
					}
					documentSymbol.value = parserTools.convert.token(value)[0]
					let lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: false })
					if (parserTools.is.comment(lookAhead)) {
						documentSymbol.inLineComment = parserTools.convert.comment(lookAhead)
						tokeniser.read() // Skip comment
					}
					else {
						lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: true })
						if (parserTools.is.osTag(lookAhead)) {
							documentSymbol.osTag = lookAhead
							tokeniser.read({ skipNewlines: true })	// Skip OS Tag
							lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: false })
							if (parserTools.is.comment(lookAhead)) {
								documentSymbol.inLineComment = parserTools.convert.comment(lookAhead)
								tokeniser.read()
							}
						}
					}
				}
			}

			documentSymbols.push(documentSymbol)

			currentToken = tokeniser.read({ skipNewlines: true })
		}

		return documentSymbols
	}

	return parseObject("document", false)
}

