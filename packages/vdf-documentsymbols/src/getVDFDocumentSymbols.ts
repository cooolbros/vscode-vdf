import { UnexpectedEndOfFileError, UnexpectedTokenError, VDFPosition, VDFRange, VDFTokenType, VDFTokeniser, type VDFParserOptions, type VDFToken } from "vdf"
import { SymbolKind } from "vscode-languageserver"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"

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
			const keyToken = tokeniser.format()

			if (keyToken != null && terminator != null ? (keyToken.type == terminator) : keyToken == terminator) {
				break
			}
			else if (keyToken == null) {
				throw new UnexpectedEndOfFileError(["key", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			switch (keyToken.type) {
				case VDFTokenType.String: {
					const key = keyToken.value
					const keyRange = keyToken.exteriorRange

					let value: string | VDFDocumentSymbols
					let valueRange: VDFRange | null
					let conditional: `[${string}]` | null

					tokeniser.allowMultilineString = typeof options.multilineStrings == "boolean"
						? options.multilineStrings
						: options.multilineStrings.has(key.toLowerCase())

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

					tokeniser.allowMultilineString = false

					switch (valueToken.type) {
						case VDFTokenType.String: {
							if (newline) {
								throw new UnexpectedTokenError(`'\\n'`, ["'{'", "value"], new VDFRange(keyRange.start, valueToken.exteriorRange.end))
							}
							value = valueToken.value
							valueRange = valueToken.range
							conditional = tokeniser.conditional()
							break
						}
						case VDFTokenType.OpeningBrace: {
							const start = new VDFPosition(tokeniser.line, tokeniser.character)
							value = parseObject(true)
							const end = new VDFPosition(tokeniser.line, tokeniser.character - 1)
							valueRange = new VDFRange(start, end)
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
					const selectionRange = new VDFRange(keyRange.start, endPosition)

					documentSymbols.push(new VDFDocumentSymbol(
						key || "\"\"",
						keyRange,
						typeof value == "object" ? SymbolKind.Object : SymbolKind.String,
						conditional,
						comments?.join("\n"),
						selectionRange,
						typeof value == "string"
							? { detail: value, range: valueRange! }
							: { children: value, range: valueRange! },
					))

					comments = []
					break
				}
				case VDFTokenType.OpeningBrace: {
					throw new UnexpectedTokenError(`'{'`, ["key"], keyToken.range)
				}
				case VDFTokenType.ClosingBrace: {
					throw new UnexpectedTokenError(`'}'`, ["key"], keyToken.range)
				}
				case VDFTokenType.Conditional: {
					throw new UnexpectedTokenError(`'${keyToken.value}'`, ["key"], keyToken.range)
				}
				case VDFTokenType.Comment: {
					(comments ??= []).push(keyToken.value)
					break
				}
			}
		}

		return documentSymbols
	}

	return parseObject(false)
}
