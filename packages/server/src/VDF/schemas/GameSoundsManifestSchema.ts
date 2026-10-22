import { resolvePath } from "common/resolvePath"
import { posix } from "path"
import { firstValueFrom, map } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbols, VDFText } from "vdf-documentsymbols"
import { Collection, Definitions, type Definition, } from "../../DefinitionReferences"
import type { DefinitionType } from "../../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, type DiagnosticsContext } from "../../DiagnosticFactory"
import type { PartialDiagnosticCodeActionReference } from "../../TextDocumentBase"
import type { Dependencies, Globals, VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

export const GameSoundsManifestSchema = (document: VDFTextDocument) => {
	const keys = new Set(["precache_file", "preload_file"])

	interface VDFManifestTextDocumentDiagnosticsContext extends DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols> {
		file: Map<string, PartialDiagnosticCodeActionReference[]>
	}

	const d = DiagnosticFactory<VDFManifestTextDocumentDiagnosticsContext, Dependencies, Globals>(document, KeyDistinct.None, (key) => key.toLowerCase())
	const file = d.file("file", null, undefined)
	const getDiagnostics = d.header(
		d.documentSymbols(Object.fromEntries(keys.keys().map((key) => [key, d.string(file.validate)])))
	)

	return {
		id: <const>"game-sounds-manifest",
		name: <const>"Game Sounds Manifest",
		definitionTypes: [],
		content$: document.documentSymbols$.pipe(
			map((documentSymbols) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

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
		getDiagnostics: (diagnostics, context) => {
			const schemaContext = {
				...context,
				file: new Map<string, PartialDiagnosticCodeActionReference[]>()
			}

			getDiagnostics(diagnostics, schemaContext)
			file.connect(diagnostics, schemaContext)
		},
		getDocumentLinks: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const manifest = documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children
			if (!manifest) {
				return []
			}

			return manifest
				.filter((documentSymbol) => keys.has(documentSymbol.key.text.toLowerCase()) && documentSymbol.value?.text.trim().length)
				.map((documentSymbol) => ({
					range: documentSymbol.value!.range,
					data: {
						resolve: async () => {
							const path = resolvePath(documentSymbol.value!.text)
							return (await firstValueFrom(document.fileSystem.resolve(path))).uri ?? document.workspace.uri.joinPath(path)
						}
					}
				}))
		},
		getDocumentColor: async () => {
			return []
		},
		onInlayHint: async (_params) => {
			return []
		},
		completion: {
			keys: async (params, path, _token) => {
				switch (path.length) {
					case 0: {
						return {
							cls: {
								one: [
									posix.parse(document.uri.basename()).name
								]
							}
						}
					}
					case 1: {
						return {
							field: {
								many: [...keys]
							}
						}
					}
					default: {
						return null
					}
				}
			},
			values: async (params, path, key, token) => {
				if (keys.has(key.toLowerCase())) {
					return await params.files({
						folder: "",
						params: params,
						token: token,
					})
				}
				return null
			},
		}
	} satisfies VDFTextDocumentSchema
}
