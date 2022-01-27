import { _Connection } from "vscode-languageserver"
import { VDFFormatTokeniser } from "./VDFFormatTokeniser"

export interface VDFFormatDocumentSymbol {
	key?: string
	value?: string | VDFFormatDocumentSymbol[]
	osTag?: string
	blockComment?: string
	inLineComment?: string
}

const whiteSpaceTokenTerminate: string[] = ["\"", "{", "}"]


export function getVDFFormatDocumentSymbols(str: string, connection: _Connection): VDFFormatDocumentSymbol[] {
	const tokeniser = new VDFFormatTokeniser(str)
	const comment = (str: string) => {
		return str.substring(2).trim()
	}
	const parseObject = (key: string, isObject: boolean): VDFFormatDocumentSymbol[] => {
		const documentSymbols: VDFFormatDocumentSymbol[] = []

		// Get first real currentToken
		let currentToken = tokeniser.next()
		while (currentToken == "\n") {
			currentToken = tokeniser.next()
		}

		const objectTerminator = isObject ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const documentSymbol: VDFFormatDocumentSymbol = {}

			// currentToken should not be '\n' here

			if (currentToken.startsWith("//")) {
				// Block Comment
				documentSymbol.blockComment = comment(currentToken)
				// Don't skip newline, block comment could be before EOF
			}
			else {
				// "key"	"value"

				if (VDFFormatTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
					throw new Error(`Key "${currentToken}" is a control character ${JSON.stringify(VDFFormatTokeniser.whiteSpaceTokenTerminate)} on line ${tokeniser.line} (Parsing ${key})`) // UnexpectedTokenError
				}

				documentSymbol.key = currentToken

				// Get Value
				let nextToken = tokeniser.next()
				while (nextToken == "\n") {
					nextToken = tokeniser.next()
				}

				// // | [$WIN32] | { | "value"

				if (nextToken.startsWith("//")) {
					// Comment after key
					// "key"	// Comment

					documentSymbol.inLineComment = comment(nextToken)

					connection.console.log(`Setting comment for ${documentSymbol.key} to ${documentSymbol.inLineComment}`)

					connection.console.log(`Skipping over "${tokeniser.next()}"`)

					nextToken = tokeniser.next(true)
					while (nextToken == "\n") {
						tokeniser.next()
						nextToken = tokeniser.next(true)
					}

					if (nextToken == "{") {
						// Object with comment
						connection.console.log(`${documentSymbol.key} is an object ("${nextToken}")`)
						tokeniser.next() // Skip over '{'
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						// Primitive
						if (nextToken == objectTerminator) {
							throw new Error(`Missing value`) // Expected value, got objectTerminator
						}
						documentSymbol.value = nextToken
						// Value has already been skipped

						// Skip all tokens that are newlines, then peek the next token
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

					if (nextToken == "{") {
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

						if (nextToken == "{") {
							// Object with OS Tag and Comment
							tokeniser.next()
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
				else if (nextToken == "{") {
					// Object
					// connection.console.log(`Skipping over "${tokeniser.next()}"`) // Skip over '{'
					documentSymbol.value = parseObject(documentSymbol.key, true)
				}
				else {
					// Primitive || Primitive with OS tag || Primitve with inline comment || primitive with OS tag and inline comment

					if (nextToken == objectTerminator || nextToken == "\n" || VDFFormatTokeniser.whiteSpaceTokenTerminate.includes(nextToken)) {
						throw new Error(`Missing value for ${documentSymbol.key} (nextToken is "${nextToken}") (objectTerminator is "${objectTerminator}")`)
					}

					documentSymbol.value = nextToken
					// connection.console.log(`[32] Setting "${documentSymbol.key}" to "${documentSymbol.value}"`)

					// Skip newlines to read OS Tag

					let lookAhead = tokeniser.next(true)
					while (lookAhead == "\n") {
						tokeniser.next()
						lookAhead = tokeniser.next(true)
					}

					if (lookAhead.startsWith("[") && lookAhead.endsWith("]")) {
						// Primitive value with OS Tag
						documentSymbol.osTag = lookAhead
						tokeniser.next()// Skip over OS Tag
						lookAhead = tokeniser.next(true)
					}

					// Dont skip newline characters, as newline terminates symbol

					if (lookAhead.startsWith("//")) {
						// Primitive value with inline comment

						documentSymbol.inLineComment = comment(lookAhead)
						tokeniser.next() // Skip over inline comment
					}
				}
			}

			documentSymbols.push(documentSymbol)

			currentToken = tokeniser.next()
			while (currentToken == "\n") {
				currentToken = tokeniser.next()
			}

			// if (currentToken == "EOF" && isObject) {
			// 	throw new Error(`Missing }!`)
			// }
		}

		return documentSymbols
	}

	return parseObject("document", false)
}

