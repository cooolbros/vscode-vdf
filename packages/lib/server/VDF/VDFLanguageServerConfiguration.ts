import type { Color, CompletionItem, DocumentLink } from "vscode-languageserver"
import type { VDFTokeniserOptions } from "../../VDF/VDFTokeniserOptions"
import type { VDFDocumentSymbol } from "../../VDFDocumentSymbols/VDFDocumentSymbol"
import type { DocumentLinkData } from "../../types/DocumentLinkData"
import type { languageClientsInfo } from "../../types/languageClientsInfo"

export interface VDFLanguageServerConfiguration {
	getVDFTokeniserOptions(uri: string): VDFTokeniserOptions,
	servers?: (keyof typeof languageClientsInfo)[]
	vpkRootPath?: string
	keyHash(key: string): string
	schema: {
		keys: { [key: string]: { reference?: string[], values: { label: string, kind: number /* CompletionItemKind */, multiple?: boolean }[] } },
		values: { [key: string]: { kind: number /* CompletionItemKind */, enumIndex?: boolean, values: string[], fix?: { [key: string]: string } } }
	}
	completion: {
		root?: CompletionItem[]
		files?: string[]
		extensions?: string[]
		typeKey?: string
		defaultType?: string,
	}
	readonly definitionReferences: VDFDefinitionReferencesConfiguration[]
	readonly links: {
		keys: Set<string>,
		check?(uri: string, documentSymbol: VDFDocumentSymbol): Promise<boolean>
		resolve(documentLink: DocumentLinkData): Promise<DocumentLink | null>
	}[]
	readonly colours: {
		keys?: Set<string>,
		parse(value: string): Color | null
		stringify(colour: Color): string
	}[]
	readonly rename?: {
		type: number,
		keys: Set<string>
	}
}

export interface VDFDefinitionReferencesConfiguration {
	/**
	 * Display Name
	 */
	readonly name: string

	/**
	 * Parent keys
	 */
	readonly parentKeys: string[]

	/**
	 * if truthy, value becomes definition name
	 */
	readonly definitionIDKey?: string

	/**
	 * DocumentSymbol must have children to qualify to be a definition, used for pin_to_sibling
	 */
	readonly definitionChildren?: boolean

	/**
	 * Set of keys where the value references this definition
	 */
	readonly referenceKeys: Set<string>

	/**
	 * Transform the reference value before referencing definition
	 * @param value
	 */
	transform?(value: string): string
}
