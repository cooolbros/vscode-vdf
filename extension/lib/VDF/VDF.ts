import { EndOfStreamError, UnexpectedTokenError } from "./VDFErrors"
import { VDFIndentation } from "./VDFIndentation"
import { VDFNewLine } from "./VDFNewLine"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"
import type { VDFStringifyOptions } from "./VDFStringifyOptions"
import { VDFTokenType } from "./VDFToken"
import { VDFTokeniser } from "./VDFTokeniser"

/**
 * Provides support for parsing and stringifying VDF objects
 */
export class VDF {

	public static readonly ConditionalDelimeter = <const>"^"

	public static parse(str: string): any {

		const tokeniser = new VDFTokeniser(str)

		const write = (obj: ReturnType<typeof VDF.parse>, key: string, value: any): void => {
			if (key in obj) {
				const existing = obj[key]
				if (Array.isArray(existing)) {
					existing.push(value)
				}
				else {
					obj[key] = [existing, value]
				}
			}
			else {
				obj[key] = value
			}
		}

		const parseObject = (isObject = false): ReturnType<typeof VDF.parse> => {

			const obj: ReturnType<typeof VDF.parse> = {}

			const objectTerminator = isObject
				? { type: VDFTokenType.ControlCharacter, value: "}" }
				: null

			while (true) {

				let key: string
				let value: string | ReturnType<typeof VDF.parse>
				let conditional: `[${string}]` | null

				const keyToken = tokeniser.next()

				if (keyToken != null && objectTerminator != null ? (keyToken.type == objectTerminator.type && keyToken.value == objectTerminator.value) : keyToken == objectTerminator) {
					break
				}
				if (keyToken == null) {
					const endOfFilePosition = new VDFPosition(tokeniser.line, tokeniser.character)
					throw new EndOfStreamError(["token"], new VDFRange(endOfFilePosition))
				}

				switch (keyToken.type) {
					case VDFTokenType.String: {

						key = keyToken.value

						let valueToken = tokeniser.next()
						if (valueToken == null) {
							throw new EndOfStreamError(["'{'", "value", "conditional"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
						}

						if (valueToken.type == VDFTokenType.Conditional) {
							conditional = <`[${string}]`>valueToken.value
							valueToken = tokeniser.next()
							if (valueToken == null) {
								throw new EndOfStreamError(["'{'", "value"], new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character)))
							}
						}

						switch (valueToken.type) {
							case VDFTokenType.ControlCharacter: {
								if (valueToken.value == "{") {
									value = parseObject(true)
									conditional = null
								}
								else {
									throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'", "value"], valueToken.range)
								}
								break
							}
							case VDFTokenType.String: {
								value = valueToken.value
								const conditionalToken = tokeniser.next(true)
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
								throw new UnexpectedTokenError(`'${valueToken.value}'`, ["'{'"], valueToken.range)
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

				if (conditional != null) {
					key += `${VDF.ConditionalDelimeter}${conditional}`
				}

				write(obj, key, value)
			}
			return obj
		}
		return parseObject()
	}

	public static stringify(obj: any, options?: Partial<VDFStringifyOptions>): any {

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


		const stringifyObject = (obj: any, level: number): string => {

			let str = ""

			let longestKeyLength = 0
			for (const key in obj) {
				longestKeyLength = Math.max(longestKeyLength, typeof obj[key] != "object" ? key.split(VDF.ConditionalDelimeter)[0].length : 0)
			}

			for (const key in obj) {
				const keyTokens = key.split(VDF.ConditionalDelimeter)
				if (Array.isArray(obj[key])) {
					for (const item of obj[key]) {
						if (typeof item == "object") {
							if (keyTokens.length > 1) {
								str += `${getIndentation(level)}"${keyTokens[0]}" ${keyTokens[1]}${eol}`
							}
							else {
								str += `${getIndentation(level)}"${key}"${eol}`
							}
							str += `${getIndentation(level)}{${eol}`
							str += `${stringifyObject(item, level + 1)}`
							str += `${getIndentation(level)}}${eol}`
						}
						else {
							if (keyTokens.length > 1) {
								str += `${getIndentation(level)}"${keyTokens[0]}"${getWhitespace(longestKeyLength, keyTokens[0].length)}"${item}" ${keyTokens[1]}${eol}`
							}
							else {
								str += `${getIndentation(level)}"${key}"${getWhitespace(longestKeyLength, key.length)}"${item}"${eol}`
							}
						}
					}
				}
				else {
					if (typeof obj[key] == "object") {
						if (keyTokens.length > 1) {
							str += `${getIndentation(level)}"${keyTokens[0]}" ${keyTokens[1]}${eol}`
						}
						else {
							str += `${getIndentation(level)}"${key}"${eol}`
						}
						str += `${getIndentation(level)}{${eol}`
						str += `${stringifyObject(obj[key], level + 1)}`
						str += `${getIndentation(level)}}${eol}`
					}
					else {
						if (keyTokens.length > 1) {
							str += `${getIndentation(level)}"${keyTokens[0]}"${getWhitespace(longestKeyLength, keyTokens[0].length)}"${obj[key]}" ${keyTokens[1]}${eol}`
						}
						else {
							str += `${getIndentation(level)}"${key}"${getWhitespace(longestKeyLength, key.length)}"${obj[key]}"${eol}`
						}
					}
				}
			}
			return str
		}
		return stringifyObject(obj, 0)
	}
}
