import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const LanguageTokensSchema: VDFTextDocumentSchema<VGUITextDocument> = {
	keys: {},
	values: {},
	getDefinitionReferences({ document, documentSymbols }) {
		const string = Symbol.for("string")

		const scopes = new Map<symbol, Map<number, VDFRange>>()
		const definitions = new Collection<Definition>()
		const references = new Collection<VDFRange>()

		const tokens = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Tokens".toLowerCase())?.children ?? []
		for (const documentSymbol of tokens) {
			if (documentSymbol.detail != undefined) {
				definitions.set(null, string, documentSymbol.key, {
					uri: document.uri,
					key: documentSymbol.key,
					range: documentSymbol.range,
					keyRange: documentSymbol.nameRange,
					nameRange: undefined,
					detail: documentSymbol.detail,
					documentation: documentSymbol.documentation,
					conditional: documentSymbol.conditional ?? undefined,
				})
			}
		}

		return {
			scopes: scopes,
			definitions: definitions,
			references: references,
		}
	},
	definitionReferences: [
		{
			type: Symbol.for("string"),
			definition: {
				match: (documentSymbol, path) => {
					if (path.length == 2 && documentSymbol.detail != undefined && path[0].key.toLowerCase() == "lang".toLowerCase() && path[1].key.toLowerCase() == "Tokens".toLowerCase()) {
						return {
							key: documentSymbol.key,
							keyRange: documentSymbol.nameRange,
						}
					}
				}
			},
			toReference: (value) => `#${value}`,
			toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, insertText: `#${definition.key}` })
		}
	],
	files: [],
	colours: {
		keys: null,
		colours: []
	},
	completion: {
		root: [],
		typeKey: null,
		defaultType: null
	}
}
