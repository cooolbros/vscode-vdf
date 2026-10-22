import { UnexpectedEndOfFileError, UnexpectedTokenError, VDFPosition, VDFRange, VDFTokenType, VDFTokeniser, type VDFParserOptions, type VDFToken } from "vdf"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"
import type { VDFText } from "./VDFText"

export function getVDFDocumentSymbols(str: string, options: VDFParserOptions): VDFDocumentSymbols {

	const tokeniser = new VDFTokeniser(str)

	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbols => {

		const documentSymbols = new VDFDocumentSymbols()
		let comments: string[] | undefined = undefined

		const terminator = obj
			? VDFTokenType.ClosingBrace
			: null

		while (true) {
			const token = tokeniser.format()

			if (token != null && terminator != null ? (token.type == terminator) : token == terminator) {
				break
			}
			else if (token == null) {
				throw new UnexpectedEndOfFileError(["key", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			switch (token.type) {
				case VDFTokenType.String: {
					const keyToken: VDFText = {
						text: token.value,
						range: token.textRange,
						tokenRange: token.range,
						quoted: token.quoted
					}

					let value: { type: 0, token: VDFText } | { type: 1, children: VDFDocumentSymbols, range: VDFRange }
					let conditional: `[${string}]` | null

					tokeniser.allowMultilineString = typeof options.multilineStrings == "boolean"
						? options.multilineStrings
						: options.multilineStrings.has(keyToken.text.toLowerCase())

					let valueToken: VDFToken | null
					let newline = false

					while (true) {
						valueToken = tokeniser.next()
						if (valueToken == null) {
							throw new UnexpectedEndOfFileError(["'{'", "value", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
						}

						if (valueToken.type == VDFTokenType.Comment) {
							(comments ??= []).push(valueToken.value)
						}
						else if (valueToken.type == VDFTokenType.NewLine) {
							newline = true
						}
						else {
							break
						}
					}

					if (valueToken.type == VDFTokenType.Conditional) {
						conditional = valueToken.value

						while (true) {
							valueToken = tokeniser.next()
							if (valueToken == null) {
								throw new UnexpectedEndOfFileError(["'{'", "value"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
							}
							else if (valueToken.type == VDFTokenType.Comment) {
								(comments ??= []).push(valueToken.value)
							}
							else if (valueToken.type == VDFTokenType.NewLine) {
								newline = true
							}
							else {
								break
							}
						}
					}

					switch (valueToken.type) {
						case VDFTokenType.String: {
							if (newline && !tokeniser.allowMultilineString) {
								throw new UnexpectedTokenError(`'\\n'`, ["'{'", "value"], new VDFRange(keyToken.range.start, valueToken.range.end))
							}
							tokeniser.allowMultilineString = false

							value = { type: 0, token: { text: valueToken.value, range: valueToken.textRange, tokenRange: valueToken.range, quoted: valueToken.quoted } }
							conditional = tokeniser.conditional()
							break
						}
						case VDFTokenType.OpeningBrace: {
							tokeniser.allowMultilineString = false

							const start = valueToken.range.start
							const children = parseObject(true)
							const end = new VDFPosition(tokeniser.line, tokeniser.character)

							value = { type: 1, children: children, range: new VDFRange(start, end) }
							conditional ??= null
							break
						}
						case VDFTokenType.ClosingBrace: {
							throw new UnexpectedTokenError(`'}'`, ["'{'", "value"], valueToken.range)
						}
						case VDFTokenType.Conditional: {
							throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'", "value"], valueToken.range)
						}
					}

					const endPosition = new VDFPosition(tokeniser.line, tokeniser.character)
					const selectionRange = new VDFRange(keyToken.tokenRange.start, endPosition)

					documentSymbols.push(new VDFDocumentSymbol(
						keyToken,
						conditional,
						comments?.join("\n"),
						selectionRange,
						value,
					))

					comments = undefined
					break
				}
				case VDFTokenType.OpeningBrace: {
					throw new UnexpectedTokenError(`'{'`, ["key"], token.range)
				}
				case VDFTokenType.ClosingBrace: {
					throw new UnexpectedTokenError(`'}'`, ["key"], token.range)
				}
				case VDFTokenType.Conditional: {
					throw new UnexpectedTokenError(`'${token.value}'`, ["key"], token.range)
				}
				case VDFTokenType.Comment: {
					(comments ??= []).push(token.value)
					break
				}
			}
		}

		return documentSymbols
	}

	return parseObject(false)
}
