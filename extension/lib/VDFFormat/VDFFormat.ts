import { VDFIndentation } from "$lib/VDF/VDFIndentation"
import { VDFNewLine } from "$lib/VDF/VDFNewLine"
import { VDFStringifyOptions } from "$lib/VDF/VDFStringifyOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { VDFFormatDocumentSymbol } from "./VDFFormatDocumentSymbol"

export function VDFFormat(str: string, options: VDFStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str), options)
}

function printVDFFormatDocumentSymbols(documentSymbols: VDFFormatDocumentSymbol[], options?: Partial<VDFStringifyOptions>): string {

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


	// Comment text
	const blockCommentAfterSlash = " "

	const lineCommentBeforeSlash = "\t"
	const lineCommentAfterSlash = " "


	const stringifyObject = (documentSymbols: VDFFormatDocumentSymbol[], level: number): string => {
		let str = ""

		let longestKeyLength = 0

		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.key && !Array.isArray(documentSymbol.value)) {
				longestKeyLength = Math.max(longestKeyLength, documentSymbol.key.length)
			}
		}

		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.blockComment != undefined) {
				str += `${getIndentation(level)}//${documentSymbol.blockComment != "" ? blockCommentAfterSlash : ""}${documentSymbol.blockComment}${eol}`
			}
			else if (documentSymbol.key != undefined && documentSymbol.value != undefined) {
				if (Array.isArray(documentSymbol.value)) {
					str += `${getIndentation(level)}"${documentSymbol.key}"`

					if (documentSymbol.conditional != undefined) {
						str += ` ${documentSymbol.conditional}`
					}

					if (documentSymbol.inLineComment != undefined) {
						str += `${lineCommentBeforeSlash}//${documentSymbol.inLineComment != "" ? lineCommentAfterSlash : ""}${documentSymbol.inLineComment}${eol}`
					}
					else {
						str += `${eol}`
					}
					str += `${getIndentation(level)}{${eol}`
					str += stringifyObject(documentSymbol.value, level + 1)
					str += `${getIndentation(level)}}${eol}`
				}
				else {
					str += `${getIndentation(level)}"${documentSymbol.key}"${getWhitespace(longestKeyLength, documentSymbol.key.length)}"${documentSymbol.value}"`
					if (documentSymbol.conditional != undefined) {
						str += ` ${documentSymbol.conditional}`
					}
					if (documentSymbol.inLineComment != undefined) {
						str += `${lineCommentBeforeSlash}//${documentSymbol.inLineComment != "" ? lineCommentAfterSlash : ""}${documentSymbol.inLineComment}`
					}
					str += `${eol}`
				}
			}
		}
		return str
	}
	return stringifyObject(documentSymbols, 0)
}
