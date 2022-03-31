import { DocumentSymbol, Position, Range, SymbolKind } from "vscode-languageserver";
import { VDFTokeniserOptions } from "./models/VDFTokeniserOptions";
import { UnexpectedTokenError } from "./VDFErrors";
import { parserTools } from "./VDFParserTools";
import { VDFTokeniser } from "./VDFTokeniser";

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	forAll(callback: (value: VDFDocumentSymbol) => void) {
		for (const documentSymbol of this) {
			if (documentSymbol.children) {
				documentSymbol.children.forAll(callback)
			}
			callback(documentSymbol)
		}
	}

	findAll(callback: (value: VDFDocumentSymbol) => boolean): { result: VDFDocumentSymbol, path: VDFDocumentSymbol[] } | undefined {
		const documentSymbolsPath: VDFDocumentSymbol[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): ReturnType<VDFDocumentSymbols["findAll"]> => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					documentSymbolsPath.push(documentSymbol)
					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result != undefined) {
						return result
					}
					documentSymbolsPath.pop()
				}

				if (callback(documentSymbol)) {
					return {
						result: documentSymbol,
						path: documentSymbolsPath
					}
				}
			}
		}

		return iterateDocumentSymbols(this)
	}

	getDocumentSymbolAtPosition(position: Position): ReturnType<VDFDocumentSymbols["findAll"]> {
		return this.findAll(value => value.range.contains(position))
	}
}

export class VDFRange implements Range {

	start: VDFPosition;
	end: VDFPosition;

	constructor(start: VDFPosition, end: VDFPosition) {
		Range.create(start, end)
		this.start = start
		this.end = end
	}

	contains(value: Position): boolean {
		return this.start.isBefore(value) && this.end.isAfter(value)
	}
}

export class VDFPosition implements Position {

	line: number;
	character: number;

	constructor(line: number, character: number) {
		Position.create(line, character)
		this.line = line
		this.character = character
	}

	isBefore(value: Position): boolean {
		if (this.line < value.line) {
			return true
		}
		if (value.line < this.line) {
			return false
		}
		return this.character < value.character
	}

	isAfter(value: Position): boolean {
		if (this.line < value.line) {
			return false;
		}
		if (value.line < this.line) {
			return true;
		}
		return this.character > value.character;
	}
}

/**
 * VDFDocumentSymbol
 */
export class VDFDocumentSymbol implements DocumentSymbol {

	/**
	 * User visible document symbol name e.g. xpos [$WIN32]
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
	readonly nameRange: VDFRange

	/**
	 * The kind of this symbol.
	*/
	readonly kind: SymbolKind;

	/**
	 * VDF Document Symbol OS Tag e.g. [$WIN32]
	 */
	readonly osTag: `[${string}]` | null

	/**
	 * VDF Document Symbol Primitive Value
	 */
	readonly detail?: string

	/**
	 * VDF Document Symbol Primitive Value Range
	 */
	readonly detailRange?: VDFRange

	/**
	 * The range enclosing this symbol not including leading/trailing whitespace but everything else
	 * like comments. This information is typically used to determine if the the clients cursor is
	 * inside the symbol to reveal in the symbol in the UI.
	 */
	readonly range: VDFRange

	/**
	 * The range that should be selected and revealed when this symbol is being picked, e.g the name of a function.
	 * Must be contained by the the `range`.
	 */
	readonly selectionRange: VDFRange

	/**
	 * VDF Document Symbol children
	 */
	readonly children?: VDFDocumentSymbols

	constructor(key: string, nameRange: VDFRange, kind: SymbolKind, osTag: `[${string}]` | null, range: VDFRange, value: string | VDFDocumentSymbols, valueRange?: VDFRange) {
		this.name = `${key}${osTag ? " " + osTag : ""}`
		this.key = key
		this.nameRange = nameRange
		this.kind = kind
		this.osTag = osTag
		this.range = range
		this.selectionRange = range

		if (typeof value == "string") {
			this.detail = value
			this.children = undefined
		}
		else {
			this.detail = undefined
			this.children = value
		}

		this.detailRange = valueRange
	}
}

export function getVDFDocumentSymbols(str: string, options?: VDFTokeniserOptions): VDFDocumentSymbols {
	const tokeniser = new VDFTokeniser(str, options)

	/**
	 * Gets a list of key/value pairs between an opening and closing brace
	 * @param obj Whether the object to be parsed is NOT a top level object
	 */
	const parseObject = (obj: boolean): VDFDocumentSymbols => {
		const documentSymbols: VDFDocumentSymbols = new VDFDocumentSymbols()

		let currentToken = tokeniser.next()
		let nextToken = tokeniser.next(true)

		const objectTerminator = obj ? "}" : "__EOF__"
		while (currentToken != objectTerminator) {
			const [key, keyQuoted] = parserTools.convert.token(currentToken)
			if (currentToken == "__EOF__" || VDFTokeniser.whiteSpaceTokenTerminate.includes(currentToken)) {
				throw new UnexpectedTokenError(currentToken, "key", Range.create(tokeniser.line, tokeniser.character - 1, tokeniser.line, tokeniser.character))
			}
			const startPosition: VDFPosition = new VDFPosition(tokeniser.line, tokeniser.character - key.length - keyQuoted)
			const nameRange: VDFRange = new VDFRange(startPosition, new VDFPosition(tokeniser.line, tokeniser.character - keyQuoted))

			nextToken = tokeniser.next()

			let osTag: `[${string}]` | undefined
			let children: VDFDocumentSymbols | undefined
			let detail: string | undefined
			let detailQuoted: 0 | 1
			let detailRange: VDFRange | undefined

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
					detailRange = new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detailQuoted), new VDFPosition(tokeniser.line, tokeniser.character - detailQuoted))

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
				detailRange = new VDFRange(new VDFPosition(tokeniser.line, tokeniser.character - detail.length - detailQuoted), new VDFPosition(tokeniser.line, tokeniser.character - detailQuoted))
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

			const endPosition = new VDFPosition(tokeniser.line, tokeniser.character)
			const selectionRange = new VDFRange(startPosition, endPosition)

			documentSymbols.push(new VDFDocumentSymbol(
				key,
				nameRange,
				children != undefined ? SymbolKind.Object : SymbolKind.String,
				osTag ?? null,
				selectionRange,
				detail ?? children!,
				detailRange
			))

			currentToken = tokeniser.next()
			nextToken = tokeniser.next(true)
		}

		return documentSymbols

	}
	return parseObject(false)
}
