// VDF

import { VDFIndentation } from "./models/VDFIndentation"
import { VDFNewLine } from "./models/VDFNewLine"
import { VDFStringifyOptions } from "./models/VDFStringifyOptions"
import { VDFTokeniserOptions } from "./models/VDFTokeniserOptions"
import { parserTools } from "./VDFParserTools"
import { VDFTokeniser } from "./VDFTokeniser"

/**
 * Provides support for parsing and stringifying VDF objects
 */
export class VDF {
	public static readonly OSTagDelimeter = <const>"^"
	public static parse(str: string, options?: VDFTokeniserOptions): { [key: string]: string | ReturnType<typeof VDF.parse> | (string | ReturnType<typeof VDF.parse>)[] } {
		const tokeniser = new VDFTokeniser(str, options)
		const write = (obj: ReturnType<typeof VDF.parse>, key: string, value: string | ReturnType<typeof VDF.parse>): void => {
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
			let currentToken = tokeniser.next()
			const objectTerminator = isObject ? "}" : "__EOF__"
			while (currentToken != objectTerminator) {
				let value = tokeniser.next()
				if (value == "{") {
					// Object
					write(obj, parserTools.convert.token(currentToken)[0], parseObject(true))
				}
				else if (parserTools.is.osTag(value)) {
					// Object with OS Tag or Primitive with 1 or 2 OS Tags
					let osTag = value
					value = tokeniser.next()
					if (value == "{") {
						// Object with OS Tag
						write(obj, `${parserTools.convert.token(currentToken)[0]}${VDF.OSTagDelimeter}${osTag}`, parseObject(true))
					}
					else {
						// Primitive with 1 or 2 OS Tags
						const lookAhead = tokeniser.next(true)
						if (parserTools.is.osTag(lookAhead)) {
							osTag = lookAhead // Second OS Tag overwrites first
							tokeniser.next() // Skip second OS Tag
						}
						write(obj, `${parserTools.convert.token(currentToken)[0]}${VDF.OSTagDelimeter}${osTag}`, parserTools.convert.token(value)[0])
					}
				}
				else {
					// Primitive
					const osTag = tokeniser.next(true)
					if (parserTools.is.osTag(osTag)) {
						currentToken += `${VDF.OSTagDelimeter}${osTag}`
						tokeniser.next() // Skip OS Tag
					}
					write(obj, parserTools.convert.token(currentToken)[0], parserTools.convert.token(value)[0])
				}
				currentToken = tokeniser.next()
			}
			return obj
		}
		return parseObject()
	}
	public static stringify(obj: any, options?: VDFStringifyOptions): any {
		const _options: Required<VDFStringifyOptions> = {
			indentation: options?.indentation ?? VDFIndentation.Tabs,
			tabSize: options?.tabSize ?? 4,
			newLine: options?.newLine ?? VDFNewLine.CRLF,
			order: options?.order ?? null
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
			let keys: string[]
			let longestKeyLength = 0
			if (_options.order != null) {
				keys = Object.keys(obj).sort((a: string, b: string) => {
					longestKeyLength = Math.max(longestKeyLength, typeof obj[a] != "object" ? a.split(VDF.OSTagDelimeter)[0].length : 0)
					// @ts-ignore
					const _a = _options.order.indexOf(a)
					if (_a == -1) {
						return 1
					}
					// @ts-ignore
					return _a - _options.order.indexOf(b)
				})
			}
			else {
				keys = []
				for (const key in obj) {
					keys.push(key)
					longestKeyLength = Math.max(longestKeyLength, typeof obj[key] != "object" ? key.split(VDF.OSTagDelimeter)[0].length : 0)
				}
			}
			for (const key of keys) {
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
