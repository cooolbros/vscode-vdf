import { _Connection } from "vscode-languageserver"
import { VDFFormatTokeniser } from "./vdf_format_tokeniser"

export interface VDFFormatDocumentSymbol {
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
						tokeniser.next()
						documentSymbol.value = parseObject(documentSymbol.key, true)
					}
					else {
						// Primitive
						if (nextToken == objectTerminator) {
							throw new Error()
						}
						documentSymbol.value = nextToken


						// Skip over value
						while (nextToken == "\n") {
							nextToken = tokeniser.next()
						}


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
						tokeniser.next()
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
				else if (nextToken == "{" && tokeniser.quoted == 0) {
					// Object
					tokeniser.next()
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

