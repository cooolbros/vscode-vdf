import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const LanguageTokensSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {

	const { header, documentSymbols, string } = document.diagnostics

	const getDiagnostics = header(
		documentSymbols(KeyDistinct.First)({
			"Language": [document.diagnostics.string()],
			"Tokens": [documentSymbols(KeyDistinct.First)({}, () => [])]
		}),
		false
	)

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
						documentation: document.definitions.documentation(documentSymbol),
						conditional: documentSymbol.conditional ?? undefined,
						completionItem: {
							labelDetails: {
								description: documentSymbol.detail
							},
							kind: CompletionItemKind.Text,
							insertText: `#${documentSymbol.key}`
						}
					})
				}
			}

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: new Map([
			[Symbol.for("string"), { keys: new Set(), toReference: (name) => `#${name}` }],
		]),
		getDiagnostics: getDiagnostics,
		getLinks: (params) => {
			return []
		},
		getColours: (params) => {
			return []
		},
		getInlayHints: async (params) => {
			return []
		},
		completion: {
			root: [],
			typeKey: null,
			defaultType: null,
			files: [],
		}
	}
}
