import { CompletionItemKind } from "vscode-languageserver"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"

export const LanguageTokensSchema: VDFTextDocumentSchema = {
	keys: {},
	values: {},
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
