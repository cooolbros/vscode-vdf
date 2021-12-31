import { _Connection } from "vscode-languageserver"
import { VDFIndentation, VDFNewLine, VDFStringifyOptions } from "../../../shared/vdf"
import { VDFFormatTokeniser } from "../../../shared/vdf/dist/vdf_format_tokeniser"

interface VDFFormatDocumentSymbol {
	key?: string
	value?: string | VDFFormatDocumentSymbol[]
	osTag?: string
	blockComment?: string
	inLineComment?: string
}
export function getVDFFormatDocumentSymbols(str: string, connection: _Connection): VDFFormatDocumentSymbol[] {

	const tokeniser = new VDFFormatTokeniser(str)

	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {

		const documentSymbols: VDFFormatDocumentSymbol[] = []


		const objectTerminator = isObject ? "}" : "EOF"
		// connection.console.log(`Reading children of ${key}, objectTerminator is ${objectTerminator}`)

		let currentToken = tokeniser.next()

		// Get first real currentToken

		while (currentToken == "\n") {
			currentToken = tokeniser.next()
		}

		let nextToken = tokeniser.next(true)

		while (currentToken != objectTerminator) {

			const documentSymbol: VDFFormatDocumentSymbol = {}

			// Get the next real currentToken

			while (currentToken == "\n") {
				currentToken = tokeniser.next()
			}

			if (currentToken.startsWith("//")) {
				// Block Comment
				documentSymbol.blockComment = currentToken.substring(2).trim()
				tokeniser.next() // Skip over newline
			}
			else {
				// "key"	"value"

				documentSymbol.key = currentToken

				while (nextToken == "\n") {
					nextToken = tokeniser.next()
				}

				// nextToken is the value of the key
				// it could be a comment, {, os tag (if object) or primitive value

				if (nextToken.startsWith("//")) {
					// Comment after key
					// "key"	"value" // Comment

					documentSymbol.inLineComment = nextToken.substring(2).trim()
					tokeniser.next() // Skip over comment

					nextToken = tokeniser.next()

					while (nextToken == "\n") {
						nextToken = tokeniser.next()
					}

					if (nextToken == "{" && tokeniser.quoted == 0) {
						// Object with comment
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						// Primitive
						if (nextToken == objectTerminator) {
							throw new Error()
						}
						documentSymbol.value = nextToken
						tokeniser.next() // Skip over value

						nextToken = tokeniser.next(true)
						while (nextToken == "\n") {
							tokeniser.next()
							nextToken = tokeniser.next(true)
						}

						if (nextToken.startsWith("[") && nextToken.endsWith("]")) {
							documentSymbol.osTag = nextToken
							tokeniser.next() // Skip over OS Tag
						}

					}
				}
				else if (nextToken.startsWith("[") && nextToken.endsWith("]")) {
					// Object with OS Tag
					documentSymbol.osTag = nextToken
					tokeniser.next() // skip over os tag

					nextToken = tokeniser.next()
					while (nextToken == "\n") {
						nextToken = tokeniser.next()
					}

					if (nextToken == "{" && tokeniser.quoted == 0) {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else if (nextToken.startsWith("//")) {
						// "key" "value" [$OSTAG] // Comment

						documentSymbol.inLineComment = nextToken.substring(2).trim()

						tokeniser.next() // Skip over comment

						nextToken = tokeniser.next()
						while (nextToken == "\n") {
							nextToken = tokeniser.next()
						}

						if (nextToken == "{" && tokeniser.quoted == 0) {
							// Object with OS Tag and Comment
							documentSymbol.value = parseObject(documentSymbol.key, true)
						}
						else {
							throw new Error(`Path not implemented. (nextToken is ${nextToken})`)
						}
					}
					else {
						throw new Error(`Path not implemented. nextToken is "${nextToken}"`)
					}
				}
				else if (nextToken == "{" && tokeniser.quoted == 0) {
					// Object
					documentSymbol.value = parseObject(documentSymbol.key, true)
				}
				else {
					// Primitive || Primitive with OS tag || Primitve with inline comment || primitive with OS tag and inline comment

					if (nextToken == objectTerminator) {
						throw new Error(`Missing value for ${documentSymbol.key} (nextToken is "${nextToken}") (objectTerminator is "${objectTerminator}")`)
					}

					documentSymbol.value = nextToken
					// connection.console.log(`[32] Setting "${documentSymbol.key}" to "${documentSymbol.value}"`)

					tokeniser.next()
					// connection.console.log(`[33] Skipping over primitive value "${next()}"`) // Skip over value

					let lookAhead = tokeniser.next(true)
					// Dont skip newline characters, as newline terminates symbol

					if (lookAhead.startsWith("[") && lookAhead.endsWith("]")) {
						// Primitive value with OS Tag
						documentSymbol.osTag = lookAhead
						tokeniser.next()// Skip over OS Tag
						lookAhead = tokeniser.next(true)
					}

					if (lookAhead.startsWith("//")) {
						// Primitive value with inline comment

						documentSymbol.inLineComment = lookAhead.substring(2).trim()
						tokeniser.next() // Skip over inline comment
					}
				}
			}

			documentSymbols.push(documentSymbol)
			// connection.console.log(`Pushing documentsymbol ${JSON.stringify(documentSymbol)}`)

			currentToken = tokeniser.next()

			if (currentToken == "EOF" && !isObject) {
				// connection.console.log(`Breaking ("EOF" and !isObject)`)
				break
			}

			// connection.console.log(`[63] currentToken is "${currentToken}"`)

			while (currentToken == "\n") {

				// connection.console.log(`Skipping ^n`)
				currentToken = tokeniser.next()
			}

			// connection.console.log(`The next real token after documentSymbol is ${currentToken}`)

			if (currentToken == "EOF" && isObject) {
				throw new Error(`Missing }!`)
			}

			// connection.console.log(`Setting currentToken to ${currentToken}`)
			nextToken = tokeniser.next(true)
			// i++
		}

		return documentSymbols
	}

	return parseObject("document", false)
}

export function printVDFFormatDocumentSymbols(documentSymbols: VDFFormatDocumentSymbol[], connection: _Connection, options?: VDFStringifyOptions): string {

	// connection.console.log(`PRINTING`)
	const _options: Required<VDFStringifyOptions> = {
		indentation: options?.indentation ?? VDFIndentation.Tabs,
		tabSize: options?.tabSize ?? 4,
		newLine: options?.newLine ?? VDFNewLine.CRLF,
		order: options?.order ?? null
	}

	// connection.console.log(JSON.stringify(_options))

	const tab: string = "\t"
	const space: string = " "
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

		let longestKeyLength: number = 0

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
					str += `${getIndentation(level)}"${documentSymbol.key}"${getWhitespace(longestKeyLength, documentSymbol.key.length)}"${documentSymbol.value}"`
					if (documentSymbol.osTag != undefined) {
						str += ` ${documentSymbol.osTag}`
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