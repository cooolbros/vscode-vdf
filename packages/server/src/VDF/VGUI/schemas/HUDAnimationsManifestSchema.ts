import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const HUDAnimationsManifestSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	const documentSymbols = document.diagnostics.documentSymbols(KeyDistinct.None)
	return {
		keys: {
			hudanimations_manifest: {
				values: [
					{
						label: "file",
						kind: CompletionItemKind.Variable,
						multiple: true
					}
				]
			}
		},
		values: {},
		getDefinitionReferences(params) {
			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: [],
		getDiagnostics: document.diagnostics.header(
			documentSymbols({
				"file": [document.diagnostics.file("file", null, null)]
			}),
			false
		),
		getLinks: ({ documentSymbols, resolve }) => {
			return documentSymbols
				.values()
				.flatMap((documentSymbol) => {
					if (!documentSymbol.children) {
						return []
					}

					return documentSymbol.children
						.values()
						.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "file" && documentSymbol.detail?.trim() != "")
						.map((documentSymbol) => ({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => {
									const path = resolve(documentSymbol.detail!)
									return await firstValueFrom(document.fileSystem.resolveFile(path))
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
		files: [
			{
				name: "file",
				keys: new Set([
					"file"
				]),
				folder: null,
				extension: null,
				extensionsPattern: null,
				resolveBaseName: (value, withExtension) => value,
			},
		],
		colours: {
			keys: null,
			colours: []
		},
		completion: {
			root: [
				{
					label: "hudanimations_manifest",
					kind: CompletionItemKind.Class
				}
			],
			typeKey: null,
			defaultType: null
		}
	}
}
