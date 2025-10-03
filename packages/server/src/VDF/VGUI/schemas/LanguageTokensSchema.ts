import type { VDFRange } from "vdf"
import { CompletionItemKind, } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const LanguageTokensSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	return {
		keys: {},
		values: {},
		getDefinitionReferences({ documentSymbols }) {
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
				toReference: (value) => `#${value}`,
				toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, insertText: `#${definition.key}` })
			}
		],
		getDiagnostics: document.diagnostics.header(
			document,
			document.diagnostics.documentSymbols(KeyDistinct.First, {
				"Language": [document.diagnostics.string()],
				"Tokens": [document.diagnostics.documentSymbols(KeyDistinct.First, {}, () => [])]
			}),
			false
		),
		getLinks: (params) => {
			return []
		},
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
}
