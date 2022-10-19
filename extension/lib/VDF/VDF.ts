import { EndOfStreamError, UnexpectedTokenError } from "./VDFErrors"
import { VDFIndentation } from "./VDFIndentation"
import { VDFNewLine } from "./VDFNewLine"
import { VDFParserTools } from "./VDFParserTools"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"
import { VDFStringifyOptions } from "./VDFStringifyOptions"
import { VDFTokeniser } from "./VDFTokeniser"

/**
 * Provides support for parsing and stringifying VDF objects
 */
export class VDF {

	public static readonly OSTagDelimeter = <const>"^"

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

			const objectTerminator = isObject ? "}" : null
			while (true) {

				let key = tokeniser.next()

				if (key == objectTerminator) {
					break
				}
				if (key == null) {
					const endOfFilePosition = new VDFPosition(tokeniser.line, tokeniser.character)
					throw new EndOfStreamError("token", new VDFRange(endOfFilePosition))
				}
				if (VDFTokeniser.whiteSpaceTokenTerminate.has(key)) {
					throw new UnexpectedTokenError(`"${key}"`, "key", new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - 1), new VDFPosition(tokeniser.line, tokeniser.character)))
				}

				let valueToken = tokeniser.next()

				if (valueToken == null) {
					const endOfFilePosition = new VDFPosition(tokeniser.line, tokeniser.character)
					throw new EndOfStreamError("value", new VDFRange(endOfFilePosition))
				}

				if (valueToken == "{") {
					write(obj, key, parseObject(true))
				}
				else if (VDFParserTools.is.conditional(valueToken)) {

					let conditional = valueToken
					valueToken = tokeniser.next()

					if (valueToken == null) {
						const endOfFilePosition = new VDFPosition(tokeniser.line, tokeniser.character)
						throw new EndOfStreamError("value", new VDFRange(endOfFilePosition))
					}

					if (valueToken == "{") {
						// Object with conditional
						write(obj, `${VDFParserTools.convert.token(key)[0]}${VDF.OSTagDelimeter}${conditional}`, parseObject(true))
					}
					else {
						// String value with 1 or 2 conditionals
						const conditionalAfterValue = tokeniser.next(true)
						if (conditionalAfterValue != null && VDFParserTools.is.conditional(conditionalAfterValue)) {
							conditional = conditionalAfterValue
							tokeniser.next()
						}
						write(obj, key, VDFParserTools.convert.token(valueToken)[0])
					}
				}
				else {
					// String with 0 or 1 conditionals
					const conditional = tokeniser.next(true)
					if (conditional != null && VDFParserTools.is.conditional(conditional)) {
						key += `${VDF.OSTagDelimeter}${conditional}`
						tokeniser.next() // Skip conditional
					}
					write(obj, key, VDFParserTools.convert.token(valueToken)[0])
				}
			}
			return obj
		}
		return parseObject()
	}

	public static stringify(obj: any, options?: Partial<VDFStringifyOptions>): any {

		const _options: VDFStringifyOptions = {
			indentation: options?.indentation ?? VDFIndentation.Tabs,
			tabSize: options?.tabSize ?? 4,
			newLine: options?.newLine ?? VDFNewLine.CRLF,
		}

		const tab = "\t"
		const space = " "
		const eol: string = _options.newLine == VDFNewLine.CRLF ? "\r\n" : "\n"
		const tabIndentation: boolean = _options.indentation == VDFIndentation.Tabs

		const getIndentation: (level: number) => string = tabIndentation
			? (level: number): string => tab.repeat(level)
			: (level: number): string => space.repeat(level * _options.tabSize)

		const getWhitespace: (longest: number, current: number) => string = tabIndentation
			? (longest: number, current: number): string => tab.repeat(Math.floor(((longest + 2) / 4) - Math.floor((current + 2) / 4)) + 2)
			: (longest: number, current: number): string => space.repeat((longest + 2) - (current + 2) + (4 - (longest + 2) % 4))

		const stringifyObject = (obj: any, level = 0): string => {

			let str = ""

			let longestKeyLength = 0
			for (const key in obj) {

				longestKeyLength = Math.max(longestKeyLength, typeof obj[key] != "object" ? key.split(VDF.OSTagDelimeter)[0].length : 0)
			}

			for (const key in obj) {
				const keyTokens: string[] = key.split(VDF.OSTagDelimeter)
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
		return stringifyObject(obj)
	}
}
