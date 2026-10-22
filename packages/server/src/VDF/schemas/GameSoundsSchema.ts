import { resolvePath } from "common/resolvePath"
import { removeSoundChars } from "common/soundChars"
import { firstValueFrom, map } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFText } from "vdf-documentsymbols"
import { CompletionItemKind, MarkupKind } from "vscode-languageserver"
import { Collection, Definitions, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import type { DocumentLinkResolve } from "../../TextDocumentBase"
import type { VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

export const GameSoundsSchema = (document: VDFTextDocument) => {
	return {
		id: <const>"game-sounds",
		name: <const>"Game Sounds",
		definitionTypes: [],
		content$: document.documentSymbols$.pipe(
			map((documentSymbols) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				for (const documentSymbol of documentSymbols) {
					const documentation = document.definitions.documentation(documentSymbol)
					definitions.set(null, types.gamesound, documentSymbol.key.text, {
						uri: document.uri,
						key: documentSymbol.key.text,
						range: documentSymbol.range,
						keyToken: documentSymbol.key,
						nameToken: undefined,
						detail: undefined,
						documentation: { kind: MarkupKind.Markdown, value: documentation },
						conditional: documentSymbol.conditional ?? undefined,
						completionItem: {
							label: `${documentSymbol.key.text}.mp3`,
							textEditText: documentSymbol.key.text,
							kind: CompletionItemKind.File,
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
			const documentSymbols = await firstValueFrom(document.documentSymbols$)

			const wave = (documentLinks: DocumentLinkResolve[], documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.value?.text.trim().length) {
					documentLinks.push({
						range: documentSymbol.value.range!,
						data: {
							resolve: async () => {
								const { chars, value } = removeSoundChars(documentSymbol.value!.text)
								return (await firstValueFrom(document.fileSystem.resolve(resolvePath(`sound/${value}`)))).uri
							}
						}
					})
				}
			}

			return documentSymbols.reduce(
				(documentLinks, documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "wave": {
								wave(documentLinks, documentSymbol)
								break
							}
							case "rndwave": {
								const children = documentSymbol.children ?? []
								for (const documentSymbol of children) {
									switch (documentSymbol.key.text.toLowerCase()) {
										case "wave": {
											wave(documentLinks, documentSymbol)
											break
										}
									}
								}
							}
						}
					}

					return documentLinks
				},
				<DocumentLinkResolve[]>[]
			)
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
