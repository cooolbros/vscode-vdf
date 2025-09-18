import { VDFTokeniser, VDFTokenType, type VDFParserOptions } from "vdf"
import type { VDFFormatKeyValue } from "./VDFFormatKeyValue"

export function getVDFFormatKeyValues(str: string, options: VDFParserOptions): VDFFormatKeyValue[] {

	const tokeniser = new VDFTokeniser(str)

	const parseObject = (isObject: boolean): VDFFormatKeyValue[] => {

		const keyValues: VDFFormatKeyValue[] = []

		const objectTerminator = isObject
			? VDFTokenType.ClosingBrace
			: null

		while (true) {

			const currentToken = tokeniser.format()

			if (currentToken != null && objectTerminator != null ? (currentToken.type == objectTerminator) : currentToken == objectTerminator) {
				break
			}
			if (currentToken == null) {
				throw new Error()
			}

			const keyValue: VDFFormatKeyValue = {}

			switch (currentToken.type) {
				case VDFTokenType.String: {
					keyValue.key = currentToken.value

					tokeniser.allowMultilineString = typeof options.multilineStrings == "boolean"
						? options.multilineStrings
						: options.multilineStrings.has(keyValue.key.toLowerCase())

					let valueToken = tokeniser.format()
					if (valueToken == null) {
						throw new Error()
					}

					switch (valueToken.type) {
						case VDFTokenType.String: {
							keyValue.value = valueToken.value
							let nextToken = tokeniser.peek()
							if (nextToken != null) {
								if (nextToken.type == VDFTokenType.Conditional) {
									keyValue.conditional = nextToken.value
									tokeniser.next()
									nextToken = tokeniser.peek()
									if (nextToken?.type == VDFTokenType.Comment) {
										keyValue.inLineComment = nextToken.value
										tokeniser.next()
									}
								}
								else if (nextToken.type == VDFTokenType.Comment) {
									keyValue.inLineComment = nextToken.value
									tokeniser.next()
								}
							}
							break
						}
						case VDFTokenType.OpeningBrace: {
							keyValue.value = parseObject(true)
							break
						}
						case VDFTokenType.ClosingBrace: {
							throw new Error()
						}
						case VDFTokenType.Conditional: {
							keyValue.conditional = valueToken.value
							valueToken = tokeniser.format()
							if (valueToken == null) {
								throw new Error()
							}

							switch (valueToken.type) {
								case VDFTokenType.String: {
									keyValue.value = valueToken.value
									break
								}
								case VDFTokenType.OpeningBrace: {
									keyValue.value = parseObject(true)
									break
								}
								case VDFTokenType.ClosingBrace: {
									throw new Error()
								}
								case VDFTokenType.Conditional: {
									throw new Error()
								}
								case VDFTokenType.Comment: {
									keyValue.inLineComment = valueToken.value
									valueToken = tokeniser.format()
									if (valueToken == null) {
										throw new Error()
									}

									if (valueToken.type == VDFTokenType.OpeningBrace) {
										keyValue.value = parseObject(true)
									}
									else {
										throw new Error()
									}

									break
								}
							}

							break
						}
						case VDFTokenType.Comment: {
							keyValue.inLineComment = valueToken.value
							const nextToken = tokeniser.format()
							if (nextToken?.type == VDFTokenType.OpeningBrace) {
								keyValue.value = parseObject(true)
							}
							else {
								throw new Error()
							}
							break
						}
					}

					break
				}
				case VDFTokenType.OpeningBrace:
					throw new Error()
				case VDFTokenType.ClosingBrace:
					throw new Error()
				case VDFTokenType.Conditional:
					throw new Error()
				case VDFTokenType.Comment: {
					keyValue.blockComment = currentToken.value.trim()
					break
				}
			}

			keyValues.push(keyValue)
		}

		return keyValues
	}

	return parseObject(false)
}
