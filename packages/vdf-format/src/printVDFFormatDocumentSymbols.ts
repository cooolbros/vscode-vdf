import { VDFIndentation, VDFNewLine } from "vdf"
import type { VDFFormatDocumentSymbol } from "./VDFFormatDocumentSymbol"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"

export function printVDFFormatDocumentSymbols(documentSymbols: VDFFormatDocumentSymbol[], options?: Partial<VDFFormatStringifyOptions>): string {

	const _options: VDFFormatStringifyOptions = {
		indentation: options?.indentation ?? VDFIndentation.Tabs,
		insertFinalNewline: options?.insertFinalNewline ?? true,
		insertNewlineBeforeObjects: options?.insertNewlineBeforeObjects ?? false,
		newLine: options?.newLine ?? VDFNewLine.CRLF,
		quotes: options?.quotes ?? true,
		tabs: options?.tabs ?? 1,
		tabSize: options?.tabSize ?? 4,
	}

	console.log(_options)

	const tab = "\t"
	const space = " "
	const eol = _options.newLine == VDFNewLine.CRLF ? "\r\n" : "\n"
	const tabIndentation = _options.indentation == VDFIndentation.Tabs

	const getIndentation: (level: number) => string = tabIndentation
		? (level: number): string => tab.repeat(level)
		: (level: number): string => space.repeat(level * _options.tabSize)

	const getWhitespace: (longest: number, current: number) => string = _options.tabs == -1
		? (): string => space
		: ((): (longest: number, current: number) => string => {
			const quotesLength = Number(_options.quotes) * 2
			switch (tabIndentation) {
				case true:
					return (longest: number, current: number): string => tab.repeat(
						0
						/* Floor the character length difference between the longest and current to get the tabs required */ + Math.floor(((longest + quotesLength) / 4) - Math.floor((current + quotesLength) / 4))
						/* Add another tab to account for keys that are already a multiple of the tab size (such as "blue_active_xpos_minmode" for tab size 4), and prevent syntax error */ + 1
						/* Add the configured tabs */ + _options.tabs
					)
				case false:
					return (longest: number, current: number): string => space.repeat(
						0
						/* Round the longest key length up to the nearest multiple of the tab size (e.g. 4) */ + (Math.ceil((longest + quotesLength) / _options.tabSize) * _options.tabSize)
						/* Add another tab to account for keys that are already a multiple of the tab size (such as "blue_active_xpos_minmode" for tab size 4), and prevent syntax error */ + _options.tabSize
						/* Subtract the current key length */ - (current + quotesLength)
						/* Add the configured tabs */ + (_options.tabs * _options.tabSize)
					)
			}
		})()

	const getToken: (key: string) => string = _options.quotes
		? (key: string): string => `"${key}"`
		: (key: string): string => !key.length || /\s/.test(key) ? `"${key}"` : key

	// Comment text
	const blockCommentAfterSlash = " "

	const lineCommentBeforeSlash = "\t"
	const lineCommentAfterSlash = " "

	const stringifyObject = (documentSymbols: VDFFormatDocumentSymbol[], level: number): string => {
		let str = ""

		let longestKeyLength = 0

		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.key && !Array.isArray(documentSymbol.value)) {
				longestKeyLength = Math.max(longestKeyLength, documentSymbol.key.length + (!_options.quotes && (!documentSymbol.key.length || /\s/.test(documentSymbol.key)) ? 2 : 0))
			}
		}

		for (const [i, documentSymbol] of documentSymbols.entries()) {
			if (documentSymbol.blockComment != undefined) {

				// If:
				// - _options.insertNewlineBeforeObjects == true
				// - we are not the first node in the tree
				// - and the previous node is not a block comment
				// - The first node after us and skipping all block comments is an object
				//
				// Insert newline on behalf of object, so that comment is printed immediately above object without newline
				// and newline is printed above block comment(s)
				if (_options.insertNewlineBeforeObjects && i != 0) {
					const prev = documentSymbols[i - 1]
					const next = documentSymbols.slice(i + 1).values().find((documentSymbol) => documentSymbol.blockComment == undefined)
					if (prev.blockComment == undefined && next && typeof next.value != "string") {
						str += eol
					}
				}

				str += `${getIndentation(level)}//${documentSymbol.blockComment != "" && documentSymbol.blockComment[0] != "/" ? blockCommentAfterSlash : ""}${documentSymbol.blockComment}`
			}
			else if (documentSymbol.key != undefined && documentSymbol.value != undefined) {
				if (Array.isArray(documentSymbol.value)) {

					// Only insert newline before object if previous node is not a comment
					if (i != 0 && _options.insertNewlineBeforeObjects && (documentSymbols[i - 1].blockComment == undefined)) {
						str += eol
					}

					str += `${getIndentation(level)}${getToken(documentSymbol.key)}`

					if (documentSymbol.conditional != undefined) {
						str += ` ${documentSymbol.conditional}`
					}

					if (documentSymbol.inLineComment != undefined) {
						str += `${lineCommentBeforeSlash}//${documentSymbol.inLineComment != "" ? lineCommentAfterSlash : ""}${documentSymbol.inLineComment}${eol}`
					}
					else {
						str += eol
					}
					str += `${getIndentation(level)}{${eol}`
					str += stringifyObject(documentSymbol.value, level + 1)
					str += `${getIndentation(level)}}`
				}
				else {
					str += `${getIndentation(level)}${getToken(documentSymbol.key)}${getWhitespace(longestKeyLength, documentSymbol.key.length + (!_options.quotes && (!documentSymbol.key.length || /\s/.test(documentSymbol.key)) ? 2 : 0))}${getToken(documentSymbol.value)}`
					if (documentSymbol.conditional != undefined) {
						str += ` ${documentSymbol.conditional}`
					}
					if (documentSymbol.inLineComment != undefined) {
						str += `${lineCommentBeforeSlash}//${documentSymbol.inLineComment != "" ? lineCommentAfterSlash : ""}${documentSymbol.inLineComment}`
					}
				}
			}

			if (level != 0 || i < documentSymbols.length - 1 || _options.insertFinalNewline) {
				str += eol
			}
		}
		return str
	}
	return stringifyObject(documentSymbols, 0)
}
