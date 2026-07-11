import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"

export const GameSoundsManifestSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {

	const { header, documentSymbols, string, file } = document.diagnostics

	const getDiagnostics = header(
		documentSymbols(KeyDistinct.None)({
			"precache_file": [string(file("precache_file", null, null))],
			"preload_file": [string(file("preload_file", null, null))],
		}),
		false
	)

	return {
		keys: {
			surfaceproperties_manifest: {
				values: [
					{
						label: "precache_file",
						kind: CompletionItemKind.Variable,
						multiple: true
					},
					{
						label: "preload_file",
						kind: CompletionItemKind.Variable,
						multiple: true
					}
				]
			}
		},
		values: {},
		getDefinitionReferences: (params) => {
			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: new Map(),
		getDiagnostics: getDiagnostics,
		getLinks: ({ documentSymbols, resolve }) => {
			return documentSymbols
				.values()
				.flatMap((documentSymbol) => {
					if (!documentSymbol.children) {
						return []
					}

					return documentSymbol.children
						.values()
						.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "precache_file" && documentSymbol.detail?.trim() != "")
						.map((documentSymbol) => ({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => {
									const path = resolve(documentSymbol.detail!)
									return (await firstValueFrom(document.fileSystem.resolve(path))).uri
										?? document.workspace?.uri.joinPath(path)
										?? null
								}
							}
						}))
				})
				.toArray()
		},
		getColours: (params) => {
			return []
		},
		getInlayHints: async (params) => {
			return []
		},
		completion: {
			root: [
				{
					label: "game_sounds_manifest",
					kind: CompletionItemKind.Class
				}
			],
			typeKey: null,
			defaultType: null,
			files: [
				{
					keys: new Set([
						"precache_file",
						"preload_file",
					]),
					folder: null,
				},
			],
		}
	}
}
