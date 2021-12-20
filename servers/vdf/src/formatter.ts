import { _Connection } from "vscode-languageserver"
import { VDFIndentation, VDFNewLine, VDFStringifyOptions } from "../../../shared/vdf"

interface VDFFormatDocumentSymbol {

	key?: string
	value?: string | VDFFormatDocumentSymbol[]
	osTag?: string
	blockComment?: string
	inLineComment?: string
}

export function getVDFFormatDocumentSymbols(str: string, connection: _Connection): VDFFormatDocumentSymbol[] {

	const whiteSpaceIgnore: string[] = [" ", "\t", "\r", "\n"]

	let i = 0
	let quoted: boolean = false

	let nextCalled = 0

	const next = (lookAhead: boolean = false): string | "__EOF__" => {


		nextCalled++

		if (nextCalled == 200) {
			throw new Error(`next called too many times!`)
		}

		let j = i
		let currentToken = ""

		if (j >= str.length) {
			if (!lookAhead) {
				i = j
			}
			return "__EOF__"
		}

		// Ignore chars
		let count1 = 0
		while (count1 < 100 && [" ", "\t", "\r"].includes(str[j])) {
			count1++
			j++
			if (j >= str.length) {
				return "__EOF__"
			}

		}
		if (count1 > 97) {
			throw new Error(`Count1 is too big!`)
		}

		if (str[j] == "\n") {
			j++ // Skip over newline
			if (!lookAhead) {
				i = j
				// connection.console.log(`Returning ^n`)
			}
			return "\n"
		}

		if (j >= str.length) {
			if (!lookAhead) {
				i = j
			}
			return "__EOF__"
		}


		if (str[j] == "\"") {
			quoted = true
			j++ // Skip over opening quote
			let count4 = 0
			while (count4 < 100 && str[j] != "\"") {
				count4++
				currentToken += str[j]
				j++
				if (j >= str.length) {
					throw new Error(`Unclosed quoted token "${currentToken}"!`)
				}

			}
			if (count4 > 97) {
				throw new Error(`Count4 is too big`)
			}
			j++ // Skip over closing quote
		}
		else {
			quoted = false
			if (str[j] == "/") {
				const j1 = j + 1
				if (j1 < str.length && str[j1] == "/") {
					let count2 = 0
					while (count2 < 100 && j < str.length && str[j] != "\r" && str[j] != "\n") {
						count2++

						if (j == str.length) {
							throw new Error(`Comment without newline "${currentToken}"!`)
						}

						currentToken += str[j]
						j++
					}
					if (count2 > 97) {
						throw new Error(`Count2 is too big!`)
					}

					if (str[j] == "\r") {
						j++
					}
				}
				else {
					j++
					if (!lookAhead) {
						i = j
					}
					return "/"
				}
			}
			else {
				let count3 = 0
				while (count3 < 100 && j < str.length && ![" ", "\t", "\r"].includes(str[j])) {
					count3++

					if (str[j] == "\\") {
						// Add backslash
						currentToken += "\\"
						j++

						if (j >= str.length) {
							throw new Error(`Unclosed escape sequence at EOF!`)
						}

						// Add character
						currentToken += str[j]
						j++

					}
					else {
						// ", {, } terminate a whitespace initiated token, but are not added
						if (["\"", "{", "}", "\n"].includes(str[j])) {
							if (currentToken == "") {
								currentToken += str[j]
								j++
							}
							// connection.console.log(`Breaking out of "${currentToken}" (Encountered "${escape(str[j])}")`)
							break
						}
						else {
							currentToken += str[j]
							j++
						}
					}
				}

				if (count3 > 97) {
					throw new Error(`Count3 is too big!`)
				}

				if (str[j] == "\r") {
					j++
				}
			}
		}

		if (!lookAhead) {
			i = j
			// connection.console.log(`Returning ${currentToken}`)
		}

		return currentToken
	}

	let parseobjectcount = 0

	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {

		parseobjectcount++

		if (parseobjectcount == 100) {
			throw new Error(`too many parseobject calls infinite reference!`)
		}

		const documentSymbols: VDFFormatDocumentSymbol[] = []


		const objectTerminator = isObject ? "}" : "__EOF__"
		connection.console.log(`Reading children of ${key}, objectTerminator is ${objectTerminator}`)

		let currentToken = next()

		// Get first real currentToken
		let count1 = 0
		while (count1 < 100 && currentToken == "\n") {
			count1++
			currentToken = next()
		}
		if (count1 > 99) {
			throw new Error(`Coutn1 is too big`)
		}

		let nextToken = next(true)

		let i = 0

		while (i < 50 && currentToken != objectTerminator) {

			i++

			const documentSymbol: VDFFormatDocumentSymbol = {}

			// Get the next real currentToken
			let count2 = 0
			while (count2 < 100 && currentToken == "\n") {
				count2++
				currentToken = next()
			}
			if (count2 > 99) {
				throw new Error(`Count2 is too big`)
			}

			if (currentToken.startsWith("//")) {
				// Block Comment

				documentSymbol.blockComment = currentToken.substring(2).trim()
				connection.console.log(`Blockcomment: ${documentSymbol.blockComment}`)

				next() // Skip over newline
			}
			else {
				// Key/Value
				documentSymbol.key = currentToken

				// Get the next real nextToken
				let count3 = 0
				while (count3 < 100 && nextToken == "\n") {
					count3++
					nextToken = next()
				}
				if (count3 > 99) {
					throw new Error(`Coutn3 is too big`)
				}

				connection.console.log(`The next real token after ${documentSymbol.key} is ${nextToken}`)

				// nextToken is the value of the key
				// it could be a comment, {, os tag (if object) or primitive value

				if (nextToken.startsWith("//")) {
					documentSymbol.inLineComment = nextToken.substring(2).trim()
					connection.console.log(`Setting documentSymbol.inLineComment to "${nextToken}"`)

					const sk = next() // Skip over comment because idk
					connection.console.log(`Skipping over "${sk}" because idk`)

					nextToken = next()
					let count4 = 0
					while (count4 < 100 && nextToken == "\n") {
						count4++
						nextToken = next()
					}
					if (count4 > 99) {
						throw new Error(`Count4 is too big`)
					}

					connection.console.log(`[56] the next real token after comment is ${nextToken}`)

					if (nextToken == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						throw new Error(`Path not implemented. (nextToken is ${nextToken})`)
					}
				}
				else if (nextToken.startsWith("[") && nextToken.endsWith("]")) {

					documentSymbol.osTag = nextToken


					const s = next() // skip over os tag
					connection.console.log(`Skipping over ${s}`)

					nextToken = next()
					let count5 = 0
					while (count5 < 100 && nextToken == "\n") {
						count5++
						nextToken = next()
					}
					if (count5 > 99) {
						throw new Error(`Count5 is too big`)
					}


					connection.console.log(`The next real token after ${documentSymbol.osTag} is ${nextToken}`)

					if (nextToken == "{") {
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else if (nextToken.startsWith("//")) {
						// Object with OS tag and comment
						documentSymbol.inLineComment = nextToken.substring(2).trim()
						nextToken = next()

						nextToken = next()
						let count6 = 0
						while (count6 < 100 && nextToken == "\n") {
							count6++
							nextToken = next()
						}
						if (count6 > 99) {
							throw new Error(`Count4 is too big`)
						}

						connection.console.log(`[56] the next real token after comment is ${nextToken}`)

						if (nextToken == "{") {
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
				else {
					if (nextToken == "{") {
						if (quoted) {
							throw new Error(`Encountered { but was not quoted!`)
						}
						// Object
						next() // Skip over opening brace
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						// Primitive || Primitive with OS tag || Primitve with inline comment || primitive with OS tag and inline comment

						if (nextToken == objectTerminator) {
							throw new Error(`Missing value for ${documentSymbol.key} (nextToken is "${nextToken}") (objectTerminator is "${objectTerminator}")`)
						}

						documentSymbol.value = nextToken
						connection.console.log(`[32] Setting "${documentSymbol.key}" to "${documentSymbol.value}"`)

						connection.console.log(`[33] Skipping over primitive value "${next()}"`) // Skip over value

						let lookAhead = next(true)
						// Dont skip newline characters, as newline terminates symbol

						if (lookAhead.startsWith("[") && lookAhead.endsWith("]")) {
							// Primitive value with OS Tag
							documentSymbol.osTag = lookAhead

							connection.console.log(`Setting OS Tag of kvpair ${documentSymbol.key}/${documentSymbol.value} to ${documentSymbol.osTag}`)

							next()// Skip over OS Tag
							lookAhead = next(true)
						}

						if (lookAhead.startsWith("//")) {
							// Primitive value with inline comment
							// documentSymbol.inLineComment = lookAhead.substring(2).trim()
							documentSymbol.inLineComment = lookAhead.substring(2).trim()
							connection.console.log(`Setting comment of kvpair ${documentSymbol.key}/${documentSymbol.value} to ${documentSymbol.inLineComment}`)

							const x = next() // Skip over inline comment
							connection.console.log(`Skipping over inline comment "${x}"`)
							// const y = next() // Skip over newline
							// connection.console.log(`Skipping over newline "${y}"`)
							// if (y == "EOF") {
							// 	throw new Error(`y is EOF`)
							// }

							// throw new Error(`y is "${y}"`)
						}
					}
				}
			}

			documentSymbols.push(documentSymbol)
			connection.console.log(`Pushing documentsymbol ${JSON.stringify(documentSymbol)}`)

			currentToken = next()

			if (currentToken == "EOF" && !isObject) {
				connection.console.log(`Breaking ("EOF" and !isObject)`)
				break
			}

			connection.console.log(`[63] currentToken is "${currentToken}"`)

			let count6 = 0
			while (count6 < 100 && currentToken == "\n") {
				count6++
				connection.console.log(`Skipping ^n`)
				currentToken = next()
			}
			if (count6 > 99) {
				throw new Error(`count6 is too big`)
			}

			connection.console.log(`The next real token after documentSymbol is ${currentToken}`)

			if (currentToken == "EOF" && isObject) {
				throw new Error(`Missing }!`)
			}

			connection.console.log(`Setting currentToken to ${currentToken}`)
			nextToken = next(true)
			i++
		}

		if (i > 45) {
			throw new Error(`Too many keys in object! ${i} ${JSON.stringify(documentSymbols)}`)
		}

		connection.console.log(`Finished object (Terminated by ${objectTerminator}) :)`)
		connection.console.log(`currentToken is ${currentToken}`)
		connection.console.log(`nextToken is ${nextToken}`)

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