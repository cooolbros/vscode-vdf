import { map } from "rxjs"
import type { VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFText } from "vdf-documentsymbols"
import { CompletionItemKind, MarkupKind } from "vscode-languageserver"
import { Collection, Definitions, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct } from "../../DiagnosticFactory"
import type { VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

export const LanguageTokensSchema = (document: VDFTextDocument) => {
	const d = DiagnosticFactory(document, KeyDistinct.First, (key) => key.toLowerCase())

	const getDiagnostics = d.header(
		d.documentSymbols({
			"Language": d.string(),
			"Tokens": d.record(d.string())
		})
	)

	return {
		id: <const>"language-tokens",
		name: <const>"Language Tokens",
		definitionTypes: [],
		content$: document.documentSymbols$.pipe(
			map((documentSymbols) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				const tokens = documentSymbols[0]?.children?.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Tokens".toLowerCase())?.children ?? new VDFDocumentSymbols()

				for (const documentSymbol of tokens) {
					if (documentSymbol.value != undefined) {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.string, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: documentSymbol.value.text,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							inlayHintLabel: {
								value: documentSymbol.value.text.includes("\\n") ? `${documentSymbol.value.text.split("\\n")[0]}…` : documentSymbol.value.text,
								tooltip: { kind: MarkupKind.Markdown, value: "```txt\n" + documentSymbol.value.text.replaceAll("\\n", "\n") + "\n```" },
							},
							completionItem: {
								label: documentSymbol.key.text,
								labelDetails: { description: documentSymbol.value.text },
								kind: CompletionItemKind.Text,
								documentation: { kind: MarkupKind.Markdown, value: documentation },
								textEditText: `#${documentSymbol.key.text}`
							}
						})
					}
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
		getDiagnostics: getDiagnostics,
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
