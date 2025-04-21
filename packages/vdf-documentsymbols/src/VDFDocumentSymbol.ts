import { VDFRange } from "vdf"
import type { DocumentSymbol, SymbolKind } from "vscode-languageserver"
import { z } from "zod"
import { VDFDocumentSymbols } from "./VDFDocumentSymbols"

/**
 * VDFDocumentSymbol
 */
export class VDFDocumentSymbol implements DocumentSymbol {

	// https://github.com/colinhacks/zod?tab=readme-ov-file#zodtype-with-zodeffects
	public static readonly schema: z.ZodType<VDFDocumentSymbol, z.ZodTypeDef, any> = z.object({
		name: z.string(),
		key: z.string(),
		nameRange: VDFRange.schema,
		kind: z.number().min(1).max(26).transform((arg) => <SymbolKind>arg),
		conditional: z.string().startsWith("[").endsWith("]").nullable(),
		range: VDFRange.schema,
		selectionRange: VDFRange.schema,
		detail: z.string().optional(),
		detailRange: VDFRange.schema.optional(),
		children: z.lazy(() => VDFDocumentSymbols.schema.optional()),
		childrenRange: VDFRange.schema.optional(),
	}).transform((arg) => new VDFDocumentSymbol(
		arg.key,
		arg.nameRange,
		arg.kind,
		<`[${string}]` | null>arg.conditional,
		arg.range,
		arg.detail != undefined
			? { detail: arg.detail!, range: arg.detailRange! }
			: { children: arg.children!, range: arg.childrenRange! }
	))

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
	 * VDF Document Symbol Conditional e.g. [$WIN32]
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

	/**
	 * VDF Document Symbol children Range
	 */
	public readonly childrenRange?: VDFRange

	constructor(key: string, nameRange: VDFRange, kind: SymbolKind, conditional: `[${string}]` | null, range: VDFRange, value: { detail: string, range: VDFRange } | { children: VDFDocumentSymbols, range: VDFRange }) {
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
			this.childrenRange = undefined
		}
		else {
			this.detail = undefined
			this.detailRange = undefined
			this.children = value.children
			this.childrenRange = value.range
		}
	}

	public toJSON(): z.input<typeof VDFDocumentSymbol.schema> {
		return {
			name: this.name,
			key: this.key,
			nameRange: this.nameRange.toJSON(),
			kind: this.kind,
			conditional: this.conditional,
			range: this.range.toJSON(),
			selectionRange: this.selectionRange.toJSON(),
			detail: this.detail,
			detailRange: this.detailRange?.toJSON(),
			children: this.children?.toJSON(),
			childrenRange: this.childrenRange?.toJSON(),
		}
	}
}
