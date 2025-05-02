import { UnexpectedEndOfFileError, UnexpectedTokenError, VDFPosition, VDFRange, VDFTokenType, VDFTokeniser, type VDFParserOptions } from "vdf"
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

		const objectTerminator = obj
			? { type: VDFTokenType.ControlCharacter, value: "}" }
			: null

		while (true) {

			let key: string
			let keyRange: VDFRange
			let value: string | VDFDocumentSymbols
			let valueRange: VDFRange | null
			let conditional: `[${string}]` | null

			const keyToken = tokeniser.next()

			if (keyToken != null && objectTerminator != null ? (keyToken.type == objectTerminator.type && keyToken.value == objectTerminator.value) : keyToken == objectTerminator) {
				break
			}
			if (keyToken == null) {
				throw new UnexpectedEndOfFileError(["key", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
			}

			switch (keyToken.type) {
				case VDFTokenType.String: {
					key = keyToken.value
					keyRange = keyToken.exteriorRange

					const allowMultilineString = typeof options.multilineStrings == "boolean" ? options.multilineStrings : options.multilineStrings.has(key.toLowerCase())

					let valueToken = tokeniser.next({ allowMultilineString })
					if (valueToken == null) {
						throw new UnexpectedEndOfFileError(["'{'", "value", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
					}

					if (valueToken.type == VDFTokenType.Conditional) {
						conditional = <`[${string}]`>valueToken.value
						valueToken = tokeniser.next({ allowMultilineString })
						if (valueToken == null) {
							throw new UnexpectedEndOfFileError(["'{'", "value"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
						}
					}

					switch (valueToken.type) {
						case VDFTokenType.ControlCharacter: {
							if (valueToken.value == "{") {
								const start = new VDFPosition(tokeniser.line, tokeniser.character)
								value = parseObject(true)
								const end = new VDFPosition(tokeniser.line, tokeniser.character - 1)
								valueRange = new VDFRange(start, end)
								conditional ??= null
								break
							}
							else {
								throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'", "value"], valueToken.range)
							}
						}
						case VDFTokenType.String: {
							value = valueToken.value
							valueRange = valueToken.range
							const conditionalToken = tokeniser.next({ peek: true })
							if (conditionalToken?.type == VDFTokenType.Conditional) {
								conditional = <`[${string}]`>conditionalToken.value
								tokeniser.next()
							}
							else {
								conditional = null
							}
							break
						}
						case VDFTokenType.Conditional: {
							throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'", "value"], valueToken.range)
						}
					}
					break
				}
				case VDFTokenType.ControlCharacter: {
					throw new UnexpectedTokenError(`'${keyToken.value}'`, ["key"], keyToken.range)
				}
				case VDFTokenType.Conditional: {
					throw new UnexpectedTokenError(`'${keyToken.value}'`, ["key"], keyToken.range)
				}
			}

			const endPosition = new VDFPosition(tokeniser.line, tokeniser.character)
			const selectionRange = new VDFRange(keyRange.start, endPosition)

			documentSymbols.push(new VDFDocumentSymbol(
				key || "\"\"",
				keyRange,
				typeof value == "object" ? SymbolKind.Object : SymbolKind.String,
				conditional,
				selectionRange,
				typeof value == "string"
					? { detail: value, range: valueRange! }
					: { children: value, range: valueRange! },
			))
		}

		return documentSymbols

	}
	return parseObject(false)
}
