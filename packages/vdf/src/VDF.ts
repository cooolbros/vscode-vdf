import { UnexpectedEndOfFileError, UnexpectedTokenError } from "./VDFErrors"
import { VDFIndentation } from "./VDFIndentation"
import { VDFNewLine } from "./VDFNewLine"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"
import type { VDFStringifyOptions } from "./VDFStringifyOptions"
import { VDFTokenType } from "./VDFToken"
import { VDFTokeniser } from "./VDFTokeniser"

export type KeyValue = { key: string, value: string | KeyValue[], conditional: string | null }

/**
 * Provides support for parsing and stringifying VDF objects
 */
export class VDF {
	static parse(str: string): KeyValue[] {
		const tokeniser = new VDFTokeniser(str)

		const parse = (obj: boolean) => {

			const keyValues: KeyValue[] = []

			const terminator = obj
				? { type: VDFTokenType.ControlCharacter, value: "}" }
				: null

			while (true) {

				let key: string
				let value: string | KeyValue[]
				let conditional: `[${string}]` | null

				const keyToken = tokeniser.next()

				if (keyToken != null && terminator != null ? (keyToken.type == terminator.type && keyToken.value == terminator.value) : keyToken == terminator) {
					break
				}
				if (keyToken == null) {
					throw new UnexpectedEndOfFileError(["key", "'}'"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
				}

				switch (keyToken.type) {
					case VDFTokenType.String: {
						key = keyToken.value

						let valueToken = tokeniser.next()
						if (valueToken == null) {
							throw new UnexpectedEndOfFileError(["'{'", "value", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
						}

						if (valueToken.type == VDFTokenType.Conditional) {
							conditional = valueToken.value
							valueToken = tokeniser.next()
							if (valueToken == null) {
								throw new UnexpectedEndOfFileError(["'{'", "value"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
							}
						}

						switch (valueToken.type) {
							case VDFTokenType.ControlCharacter: {
								if (valueToken.value == "{") {
									value = parse(true)
									conditional ??= null
									break
								}
								else {
									throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'", "value"], valueToken.range)
								}
							}
							case VDFTokenType.String: {
								value = valueToken.value
								const conditionalToken = tokeniser.next(true)
								if (conditionalToken?.type == VDFTokenType.Conditional) {
									conditional = conditionalToken.value
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

				keyValues.push({
					key,
					value,
					conditional
				})
			}

			return keyValues
		}

		return parse(false)
	}

	static stringify(keyValues: KeyValue[], options?: Partial<VDFStringifyOptions>): string {

		const _options: VDFStringifyOptions = {
			indentation: options?.indentation ?? VDFIndentation.Tabs,
			newLine: options?.newLine ?? VDFNewLine.CRLF,
			tabSize: options?.tabSize ?? 4
		}

		const tab = "\t"
		const space = " "
		const eol = _options.newLine == VDFNewLine.CRLF ? "\r\n" : "\n"
		const tabIndentation = _options.indentation == VDFIndentation.Tabs

		const getIndentation: (level: number) => string = tabIndentation
			? (level: number): string => tab.repeat(level)
			: (level: number): string => space.repeat(level * _options.tabSize)

		const getWhitespace: (longest: number, current: number) => string = tabIndentation
			? (longest: number, current: number): string => tab.repeat(Math.floor(((longest + 2) / 4) - Math.floor((current + 2) / 4)) + 2)
			: (longest: number, current: number): string => space.repeat((longest + 2) - (current + 2) + (4 - (longest + 2) % 4))

		const stringify = (arr: KeyValue[], level = 0) => {

			let str = ""

			let longestKeyLength = 0
			for (const { key, value } of arr) {
				longestKeyLength = Math.max(longestKeyLength, typeof value == "string" ? key.length : 0)
			}

			for (const keyValue of arr) {
				str += `${getIndentation(level)}"${keyValue.key}"`
				if (typeof keyValue.value == "string") {
					str += `${getWhitespace(longestKeyLength, keyValue.key.length)}"${keyValue.value}"`
					if (keyValue.conditional != null) {
						str += ` ${keyValue.conditional}`
					}
					str += eol
				}
				else {
					if (keyValue.conditional != null) {
						str += ` ${keyValue.conditional}`
					}
					str += eol
					str += `${getIndentation(level)}{${eol}`
					str += stringify(keyValue.value, level + 1)
					str += `${getIndentation(level)}}${eol}`
				}
			}

			return str
		}
		return stringify(keyValues)
	}
}
