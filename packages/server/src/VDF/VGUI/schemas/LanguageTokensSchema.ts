import { CompletionItemKind } from "vscode-languageserver"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"

export const LanguageTokensSchema: VDFTextDocumentSchema = {
	keys: {},
	values: {},
	definitionReferences: [
		{
			type: Symbol.for("string"),
			definition: {
				directParentKeys: [
					"lang",
					"Tokens".toLowerCase()
				],
				children: false,
				key: null,
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
