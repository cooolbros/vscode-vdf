import { DocumentSymbol, Position, Range, SymbolKind } from "vscode-languageserver";
import { VDFTokeniserOptions } from "./models/VDFTokeniserOptions";
import { UnexpectedTokenError } from "./VDFErrors";
import { parserTools } from "./VDFParserTools";
import { VDFTokeniser } from "./VDFTokeniser";

export interface VDFDocumentSymbol extends DocumentSymbol {

	/**
	 * User visible document symbol name e.g. xpos
	 */
	readonly name: string


	/**
	 * Documentsymbol VDF key e.g. xpos\
	 * This key does not contain the OS Tag, instead access VDFDocumentSymbol.osTag
	 */
	readonly key: string

	/**
	 * Document range containing key
	 */
	readonly nameRange: Range

	/**
	 * VDF Document Symbol OS Tag e.g. [$WIN32]
	 */
	readonly osTag?: string

	/**
	 * VDF Document Symbol Primitive Value
	 */
	readonly detail?: string

	/**
	 * VDF Document Symbol Primitive Value Range
	 */
	readonly detailRange?: Range

	/**
	 * VDF Document Symbol children
	 */
	readonly children?: VDFDocumentSymbol[]
}

export function getVDFDocumentSymbols(str: string, options?: VDFTokeniserOptions): VDFDocumentSymbol[] {
	const tokeniser = new VDFTokeniser(str, options)

	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbol[] => {
		const documentSymbols: VDFDocumentSymbol[] = []

		let currentToken = tokeniser.next()
		let nextToken = tokeniser.next(true)

		const objectTerminator = obj ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const [key, keyQuoted] = parserTools.convert.token(currentToken)
			if (currentToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
				throw new UnexpectedTokenError(currentToken, "key", Range.create(tokeniser.line, tokeniser.character - 1, tokeniser.line, tokeniser.character))
			}
			const startPosition = Position.create(tokeniser.line, tokeniser.character - key.length - keyQuoted)
			const nameRange: Range = Range.create(startPosition, Position.create(tokeniser.line, tokeniser.character - keyQuoted))

			nextToken = tokeniser.next()

			let osTag: string | undefined
			let children: VDFDocumentSymbol[] | undefined
			let detail: string | undefined
			let detailQuoted: 0 | 1
			let detailRange: Range | undefined

			if (nextToken == "{") {
				children = parseObject(true)
			}
			else if (parserTools.is.osTag(nextToken)) {
				osTag = nextToken
				const value = tokeniser.next()
				if (value == "{") {
					// Object
					children = parseObject(true)
				}
				else {
					// Primitive
					[detail, detailQuoted] = parserTools.convert.token(value)
					detailRange = Range.create(Position.create(tokeniser.line, tokeniser.character - detail.length - detailQuoted), Position.create(tokeniser.line, tokeniser.character - detailQuoted))

					if (value == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(detail)) {
						throw new UnexpectedTokenError(value, "value", detailRange)
					}

					let osTag2 = tokeniser.next(true)
					if (parserTools.is.osTag(osTag2)) {
						osTag = osTag2
						tokeniser.next() // Skip OS Tag
					}
				}
			}
			else {
				[detail, detailQuoted] = parserTools.convert.token(nextToken)
				detailRange = Range.create(Position.create(tokeniser.line, tokeniser.character - detail.length - detailQuoted), Position.create(tokeniser.line, tokeniser.character - detailQuoted))
				if (nextToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(nextToken)) {
					throw new UnexpectedTokenError(detail, "value", detailRange)
				}

				// OS Tag
				nextToken = tokeniser.next(true)
				if (parserTools.is.osTag(nextToken)) {
					osTag = nextToken
					tokeniser.next()
				}
			}

			const endPosition = Position.create(tokeniser.line, tokeniser.character)
			const selectionRange = Range.create(startPosition, endPosition)

			documentSymbols.push({
				name: `${key}${osTag != undefined ? ` ${osTag}` : ""}`,
				key: key,
				nameRange: nameRange,
				kind: children != undefined ? SymbolKind.Object : SymbolKind.String,
				range: selectionRange,
				selectionRange: selectionRange,
				...(osTag != undefined && {
					osTag: osTag
				}),
				...(children != undefined && {
					children: children
				}),
				...(detail != undefined && {
					detail: detail
				}),
				...(detailRange != undefined && {
					detailRange: detailRange
				})
			})

			currentToken = tokeniser.next()
			nextToken = tokeniser.next(true)
		}

		return documentSymbols

	}
	return parseObject(false)
}
