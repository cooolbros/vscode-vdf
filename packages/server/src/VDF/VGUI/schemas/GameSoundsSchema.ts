import { removeSoundChars } from "common/soundChars"
import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { DocumentLinkData } from "../../../TextDocumentBase"
import { type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"

export const GameSoundsSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {
	return {
		keys: {},
		values: {},
		getDefinitionReferences: (params) => {
			const game_sound = Symbol.for("game_sound")

			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			for (const documentSymbol of params.getDocumentSymbols()) {
				definitions.set(null, game_sound, documentSymbol.key, {
					uri: document.uri,
					key: documentSymbol.key,
					range: documentSymbol.range,
					keyRange: documentSymbol.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(documentSymbol),
					conditional: documentSymbol.conditional ?? undefined,
				})
			}

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: new Map(),
		getDiagnostics: (params) => {
			return []
		},
		getLinks: ({ documentSymbols, resolve }) => {
			const links: DocumentLinkData[] = []

			const wave = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail?.length) {
					links.push({
						range: documentSymbol.detailRange!,
						data: {
							resolve: async () => {
								const { chars, value } = removeSoundChars(documentSymbol.detail!)

								return (await firstValueFrom(document.fileSystem.resolve(resolve(`sound/${documentSymbol.detail}`)))).uri
							}
						}
					})
				}
			}

			for (const documentSymbol of documentSymbols) {
				const children = documentSymbol.children ?? []
				for (const documentSymbol of children) {
					switch (documentSymbol.key.toLowerCase()) {
						case "wave": {
							wave(documentSymbol)
							break
						}
						case "rndwave": {
							const children = documentSymbol.children ?? []
							for (const documentSymbol of children) {
								switch (documentSymbol.key.toLowerCase()) {
									case "wave": {
										wave(documentSymbol)
										break
									}
								}
							}
						}
					}
				}
			}

			return links
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
			files: [
				{
					keys: new Set([
						"wave"
					]),
					folder: "sound"
				},
			],
		}
	}
}
