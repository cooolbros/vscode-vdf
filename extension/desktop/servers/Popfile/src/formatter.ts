import { _Connection } from "vscode-languageserver"
import { getVDFFormatDocumentSymbols, VDFFormatDocumentSymbol } from "../../../shared/vdf/dist/getVDFFormatDocumentSymbols"
import { VDFIndentation } from "../../../shared/VDF/dist/models/VDFIndentation"
import { VDFNewLine } from "../../../shared/VDF/dist/models/VDFNewLine"
import { VDFStringifyOptions } from "../../../shared/VDF/dist/models/VDFStringifyOptions"

export function format(str: string, connection: _Connection): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str, connection), connection)
}

function printVDFFormatDocumentSymbols(documentSymbols: VDFFormatDocumentSymbol[], connection: _Connection, options?: VDFStringifyOptions): string {

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
		? (level: number) => tab.repeat(level)
		: (level: number) => space.repeat(level * _options.tabSize)
	const getWhitespace: (longest: number, current: number) => string = tabIndentation
		? (longest: number, current: number) => tab.repeat(Math.floor(((longest + 2) / 4) - Math.floor((current + 2) / 4)) + 2)
		: (longest: number, current: number) => space.repeat((longest + 2) - (current + 2) + (4 - (longest + 2) % 4))


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

		let previousTokenWasPrimitiveValue = false

		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.blockComment != undefined) {
				str += `${getIndentation(level)}//${documentSymbol.blockComment != "" ? blockCommentAfterSlash : ""}${documentSymbol.blockComment}${eol}`
			}
			else if (documentSymbol.key != undefined && documentSymbol.value != undefined) {
				if (Array.isArray(documentSymbol.value)) {

					if (previousTokenWasPrimitiveValue) {
						str += `${eol}`
					}

					str += `${getIndentation(level)}${/\s/.test(documentSymbol.key) ? `"${documentSymbol.key}"` : documentSymbol.key}`

					if (documentSymbol.osTag != undefined) {
						str += ` ${documentSymbol.osTag}`
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
					str += `${getIndentation(level)}${/\s/.test(documentSymbol.key) ? `"${documentSymbol.key}"` : documentSymbol.key} ${/\s/.test(documentSymbol.value) ? `"${documentSymbol.value}"` : documentSymbol.value}`
					if (documentSymbol.osTag != undefined) {
						str += ` ${documentSymbol.osTag}`
					}
					if (documentSymbol.inLineComment != undefined) {
						str += `${lineCommentBeforeSlash}//${documentSymbol.inLineComment != "" ? lineCommentAfterSlash : ""}${documentSymbol.inLineComment}`
					}
					str += `${eol}`
				}
			}

			previousTokenWasPrimitiveValue = documentSymbol.value != undefined
		}
		return str
	}

	return stringifyObject(documentSymbols, 0)
}
