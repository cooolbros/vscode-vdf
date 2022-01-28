import { _Connection } from "vscode-languageserver"
import { VDFFormatTokeniser } from "./VDFFormatTokeniser"
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
		super(`Invalid token sequence! ("${tokens.join(`", "`)}")`)
	}
}


export function getVDFFormatDocumentSymbols(str: string, connection: _Connection): VDFFormatDocumentSymbol[] {
	const tokeniser = new VDFFormatTokeniser(str)
	const isComment = (str: string): str is `//${string}` => {
		return str.startsWith("//")
	}
	const isOSTag = (str: string): str is `[${string}]` => {
		return str.startsWith("[") && str.endsWith("]")
	}
	const trim = (str: string): [string, 0 | 1] => {
		const quoted = str.startsWith("\"") && str.endsWith("\"")
		return quoted ? [str.slice(1, -1), 1] : [str, 0];
	}
	const comment = (str: `//${string}`): string => {
		return str.substring(2).trim()
	}
	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {
		const documentSymbols: VDFFormatDocumentSymbol[] = []

		// Get first real currentToken
		let currentToken = tokeniser.read({ skipNewlines: true })

		const objectTerminator = isObject ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const documentSymbol: VDFFormatDocumentSymbol = {}

			if (isComment(currentToken)) {
				// Block comment
				documentSymbol.blockComment = comment(currentToken)
			}
			else {
				if (currentToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
					throw new InvalidTokenSequenceError(currentToken)
				}
				documentSymbol.key = trim(currentToken)[0]
				let value = tokeniser.read({ skipNewlines: true })
				if (isComment(value)) {
					documentSymbol.inLineComment = comment(value)
					value = tokeniser.read({ skipNewlines: true })
					if (value == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						throw new InvalidTokenSequenceError(documentSymbol.key, documentSymbol.inLineComment, value)
					}
				}
				else if (isOSTag(value)) {
					documentSymbol.osTag = value
					value = tokeniser.read({ skipNewlines: true })
					if (isComment(value)) {
						documentSymbol.inLineComment = comment(value)
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
						documentSymbol.value = trim(value)[0]
					}
				}
				else if (value == "{") {
					documentSymbol.value = parseObject(documentSymbol.key, true)
				}
				else {
					if (value == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(value)) {
						throw new InvalidTokenSequenceError(documentSymbol.key, value)
					}
					documentSymbol.value = trim(value)[0]
					let lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: false })
					if (isComment(lookAhead)) {
						documentSymbol.inLineComment = comment(lookAhead)
						tokeniser.read() // Skip comment
					}
					else {
						lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: true })
						if (isOSTag(lookAhead)) {
							documentSymbol.osTag = lookAhead
							tokeniser.read({ skipNewlines: true })	// Skip OS Tag
							lookAhead = tokeniser.read({ lookAhead: true, skipNewlines: false })
							if (isComment(lookAhead)) {
								documentSymbol.inLineComment = comment(lookAhead)
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

