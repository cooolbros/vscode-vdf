import type { DocumentSymbol, SymbolKind } from "vscode-languageserver"
import type { VDFRange } from "../VDF/VDFRange"
import type { VDFDocumentSymbols } from "./VDFDocumentSymbols"

/**
 * VDFDocumentSymbol
 */
export class VDFDocumentSymbol implements DocumentSymbol {

	/**
	 * User visible document symbol name e.g. xpos [$WIN32]
	 */
	public readonly name: string

	/**
	 * Documentsymbol VDF key e.g. xpos\
	 * This key does not contain the OS Tag, instead access VDFDocumentSymbol.osTag
	 */
	public readonly key: string

	/**
	 * Document range containing key
	 */
	public readonly nameRange: VDFRange

	/**
	 * The kind of this symbol.
	*/
	public readonly kind: SymbolKind

	/**
	 * VDF Document Symbol OS Tag e.g. [$WIN32]
	 */
	public readonly conditional: `[${string}]` | null

	/**
	 * VDF Document Symbol Primitive Value
	 */
	public readonly detail?: string

	/**
	 * VDF Document Symbol Primitive Value Range
	 */
	public readonly detailRange?: VDFRange

	/**
	 * The range enclosing this symbol not including leading/trailing whitespace but everything else
	 * like comments. This information is typically used to determine if the the clients cursor is
	 * inside the symbol to reveal in the symbol in the UI.
	 */
	public readonly range: VDFRange

	/**
	 * The range that should be selected and revealed when this symbol is being picked, e.g the name of a function.
	 * Must be contained by the the `range`.
	 */
	public readonly selectionRange: VDFRange

	/**
	 * VDF Document Symbol children
	 */
	public readonly children?: VDFDocumentSymbols

	constructor(key: string, nameRange: VDFRange, kind: SymbolKind, conditional: `[${string}]` | null, range: VDFRange, value: { detail: string, range: VDFRange } | VDFDocumentSymbols) {
		this.name = `${key}${conditional ? " " + conditional : ""}`
		this.key = key
		this.nameRange = nameRange
		this.kind = kind
		this.conditional = conditional
		this.range = range
		this.selectionRange = range

		if ("detail" in value) {
			this.detail = value.detail
			this.detailRange = value.range
			this.children = undefined
		}
		else {
			this.detail = undefined
			this.detailRange = undefined
			this.children = value
		}
	}
}
