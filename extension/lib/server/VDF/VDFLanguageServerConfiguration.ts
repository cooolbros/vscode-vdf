import type { languageClientsInfo } from "$lib/languageClientsInfo"
import type { DocumentLinkData } from "$lib/types/DocumentLinkData"
import type { VDFDocumentSymbol } from "$lib/VDFDocumentSymbols/VDFDocumentSymbol"
import type { Color, CompletionItem, DocumentLink } from "vscode-languageserver"

export interface VDFLanguageServerConfiguration {
	servers?: (keyof typeof languageClientsInfo)[]
	vpkRootPath?: string
	keyHash(key: string): string
	schema: {
		keys: { [key: string]: { reference?: string[], values: { label: string, kind: number /* CompletionItemKind */ }[] } },
		values: { [key: string]: { kind: number /* CompletionItemKind */, enumIndex?: boolean, values: string[] } }
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
}
