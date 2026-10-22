import { VDFRange } from "vdf"
import { SymbolKind, type DocumentSymbol } from "vscode-languageserver"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"
import type { VDFText } from "./VDFText"

/**
 * VDFDocumentSymbol
 */
export class VDFDocumentSymbol implements DocumentSymbol {

	/**
	 * User visible document symbol name e.g. xpos [$WIN32]
	 * @deprecated Use {@link key}
	 */
	public readonly name: string

	/**
	 * Documentsymbol VDF key e.g. xpos
	 *
	 * This key does not contain the conditional, instead access {@link conditional}
	 */
	public readonly key: VDFText

	/**
	 * The kind of this symbol.
	*/
	public readonly kind: SymbolKind

	/**
	 * VDF Document Symbol Conditional e.g. [$WIN32]
	 */
	public readonly conditional: `[${string}]` | null

	/**
	 * VDF Document Symbol Primitive Value
	 */
	public readonly value?: VDFText

	/**
	 * @deprecated Use {@link value}
	 */
	public get detail() {
		return this.value?.text
	}

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

	/**
	 * VDF Document Symbol children Range
	 */
	public readonly childrenRange?: VDFRange

	/**
	 * VDF Document Symbol documentation
	 */
	public readonly documentation?: string

	public constructor(key: VDFText, conditional: `[${string}]` | null, documentation: string | undefined, range: VDFRange, value: { type: 0, token: VDFText } | { type: 1, children: VDFDocumentSymbols, range: VDFRange }) {
		// oxlint-disable-next-line typescript/no-deprecated
		this.name = `${key.text || `""`}${conditional ? ` ${conditional}` : ""}`
		this.key = key
		this.conditional = conditional
		this.range = range
		this.selectionRange = range
		this.documentation = documentation

		if ("token" in value) {
			// typeof value == "object" ? SymbolKind.Object : SymbolKind.String,
			this.kind = SymbolKind.Field
			this.value = value.token
			this.children = undefined
			this.childrenRange = undefined
		}
		else {
			this.kind = SymbolKind.Object
			this.value = undefined
			this.children = value.children
			this.childrenRange = value.range
		}
	}

	public toJSON(): DocumentSymbol {
		return {
			// oxlint-disable-next-line typescript/no-deprecated
			name: this.name,
			// oxlint-disable-next-line typescript/no-deprecated
			detail: this.detail,
			kind: this.kind,
			range: this.range,
			selectionRange: this.key.range,
			children: <DocumentSymbol[] | undefined>this.children,
		}
	}
}
