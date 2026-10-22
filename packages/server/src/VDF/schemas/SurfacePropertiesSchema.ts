import { map } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { CompletionItemKind, MarkupKind } from "vscode-languageserver"
import { Collection, Definitions, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import type { VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

export const SurfacePropertiesSchema = (document: VDFTextDocument) => {
	return {
		id: <const>"surface-properties",
		name: <const>"Surface Properties",
		definitionTypes: [],
		content$: document.documentSymbols$.pipe(
			map((documentSymbols) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				for (const documentSymbol of documentSymbols) {
					const documentation = document.definitions.documentation(documentSymbol)
					definitions.set(null, types.surfaceprop, documentSymbol.key.text, {
						uri: document.uri,
						key: documentSymbol.key.text,
						range: documentSymbol.range,
						keyToken: documentSymbol.key,
						nameToken: undefined,
						detail: undefined,
						documentation: { kind: MarkupKind.Markdown, value: documentation },
						conditional: documentSymbol.conditional ?? undefined,
						completionItem: {
							label: documentSymbol.key.text,
							kind: CompletionItemKind.Unit,
							documentation: { kind: MarkupKind.Markdown, value: documentation }
						}
					})
				}

				return {
					documentSymbols: documentSymbols,
					definitionReferences: {
						scopes: scopes,
						definitions: new Definitions([document.version], definitions),
						references: references,
					}
				}
			})
		),
		getDiagnostics: (diagnostics, context) => { },
		getDocumentLinks: async () => {
			return []
		},
		getDocumentColor: async () => {
			return []
		},
		onInlayHint: async (params) => {
			return []
		},
		completion: {
			keys: async () => null,
			values: async () => null,
		}
	} satisfies VDFTextDocumentSchema
}
