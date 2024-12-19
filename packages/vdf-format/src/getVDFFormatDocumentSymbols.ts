import type { VDFParserOptions } from "vdf"
import type { VDFFormatDocumentSymbol } from "./VDFFormatDocumentSymbol"
import { VDFFormatTokeniser, VDFFormatTokenType } from "./VDFFormatTokeniser"

export function getVDFFormatDocumentSymbols(str: string, options: VDFParserOptions): VDFFormatDocumentSymbol[] {

	const tokeniser = new VDFFormatTokeniser(str)

	const parseObject = (isObject: boolean): VDFFormatDocumentSymbol[] => {

		const documentSymbols: VDFFormatDocumentSymbol[] = []

		const objectTerminator = isObject
			? { type: VDFFormatTokenType.ControlCharacter, value: "}" }
			: null

		while (true) {

			const currentToken = tokeniser.next({ skipNewlines: true })

			if (currentToken != null && objectTerminator != null ? (currentToken.type == objectTerminator.type && currentToken.value == objectTerminator.value) : currentToken == objectTerminator) {
				break
			}
			if (currentToken == null) {
				throw new Error()
			}

			const documentSymbol: VDFFormatDocumentSymbol = {}

			switch (currentToken.type) {
				case VDFFormatTokenType.Comment: {
					documentSymbol.blockComment = currentToken.value.trim()
					break
				}
				case VDFFormatTokenType.String: {
					documentSymbol.key = currentToken.value

					const allowMultilineString = typeof options.multilineStrings == "boolean" ? options.multilineStrings : options.multilineStrings.has(documentSymbol.key.toLowerCase())

					let valueToken = tokeniser.next({ skipNewlines: true, allowMultilineString: allowMultilineString })
					if (valueToken == null) {
						throw new Error()
					}

					switch (valueToken.type) {
						case VDFFormatTokenType.Comment: {
							documentSymbol.inLineComment = valueToken.value.trim()
							const nextToken = tokeniser.next({ skipNewlines: true })
							if (nextToken?.type == VDFFormatTokenType.ControlCharacter && nextToken.value == "{") {
								documentSymbol.value = parseObject(true)
							}
							else {
								throw new Error()
							}
							break
						}
						case VDFFormatTokenType.Conditional: {
							documentSymbol.conditional = <`[${string}]`>valueToken.value
							valueToken = tokeniser.next({ skipNewlines: true, allowMultilineString: allowMultilineString })
							if (valueToken == null) {
								throw new Error()
							}
							switch (valueToken.type) {
								case VDFFormatTokenType.Comment: {
									documentSymbol.inLineComment = valueToken.value.trim()
									valueToken = tokeniser.next({ skipNewlines: true })
									if (valueToken == null) {
										throw new Error()
									}
									if (valueToken.type == VDFFormatTokenType.ControlCharacter && valueToken.value == "{") {
										documentSymbol.value = parseObject(true)
									}
									else {
										throw new Error()
									}
									break
								}
								case VDFFormatTokenType.ControlCharacter: {
									if (valueToken.value == "{") {
										documentSymbol.value = parseObject(true)
										break
									}
									else {
										throw new Error()
									}
								}
								case VDFFormatTokenType.String: {
									documentSymbol.value = valueToken.value
								}
							}
							break
						}
						case VDFFormatTokenType.ControlCharacter: {
							if (valueToken.value == "{") {
								documentSymbol.value = parseObject(true)
								break
							}
							else {
								throw new Error()
							}
						}
						case VDFFormatTokenType.String: {
							documentSymbol.value = valueToken.value

							const nextToken = tokeniser.next({ skipNewlines: false, peek: true })
							switch (nextToken?.type) {
								case VDFFormatTokenType.Conditional: {
									documentSymbol.conditional = <`[${string}]`>nextToken.value
									tokeniser.next({ skipNewlines: false })
									const lookAheadToken = tokeniser.next({ skipNewlines: false, peek: true })
									if (lookAheadToken?.type == VDFFormatTokenType.Comment) {
										documentSymbol.inLineComment = lookAheadToken.value.trim()
										tokeniser.next({ skipNewlines: false })
									}
									break
								}
								case VDFFormatTokenType.Comment: {
									documentSymbol.inLineComment = nextToken.value.trim()
									tokeniser.next({ skipNewlines: false })
								}
							}
						}
					}

					break
				}
				case VDFFormatTokenType.Conditional:
				case VDFFormatTokenType.ControlCharacter:
				case VDFFormatTokenType.NewLine: {
					throw new Error()
				}
			}

			documentSymbols.push(documentSymbol)
		}

		return documentSymbols
	}

	return parseObject(false)
}
