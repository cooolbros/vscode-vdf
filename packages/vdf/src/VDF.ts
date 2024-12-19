import { UnexpectedEndOfFileError, UnexpectedTokenError } from "./VDFErrors"
import { VDFIndentation } from "./VDFIndentation"
import { VDFNewLine } from "./VDFNewLine"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"
import type { VDFStringifyOptions } from "./VDFStringifyOptions"
import { VDFTokenType } from "./VDFToken"
import { VDFTokeniser } from "./VDFTokeniser"

export type KeyValues = { [key: string]: string | KeyValues | (string | KeyValues)[] }

/**
 * Provides support for parsing and stringifying VDF objects
 */
export class VDF {
	static parse(str: string): KeyValues {
		const tokeniser = new VDFTokeniser(str)

		const parse = (obj: boolean) => {

			const keyValues: KeyValues = {}

			const terminator = obj
				? { type: VDFTokenType.ControlCharacter, value: "}" }
				: null

			while (true) {

				let key: string
				let value: string | KeyValues
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
								const conditionalToken = tokeniser.next({ peek: true })
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

				if (key in keyValues) {
					const existing = keyValues[key]
					if (Array.isArray(existing)) {
						existing.push(value)
					}
					else {
						keyValues[key] = [existing, value]
					}
				}
				else {
					keyValues[key] = value
				}
			}

			return keyValues
		}

		return parse(false)
	}

	static stringify(keyValues: KeyValues, options?: Partial<VDFStringifyOptions>): string {

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

		const stringify = (obj: KeyValues, level = 0) => {

			let str = ""

			let longestKeyLength = 0
			for (const key in obj) {
				longestKeyLength = Math.max(longestKeyLength, key.length)
			}

			for (const key in obj) {
				for (const value of Array.isArray(obj[key]) ? obj[key] : [obj[key]]) {
					str += `${getIndentation(level)}"${key}"`
					if (typeof value == "string") {
						str += `${getWhitespace(longestKeyLength, key.length)}"${value}"${eol}`
					}
					else {
						str += eol
						str += `${getIndentation(level)}{${eol}`
						str += stringify(value, level + 1)
						str += `${getIndentation(level)}}${eol}`
					}
				}
			}

			return str
		}
		return stringify(keyValues)
	}
}
