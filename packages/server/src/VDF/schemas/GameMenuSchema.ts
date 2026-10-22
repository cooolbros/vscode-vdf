import { resolvePath } from "common/resolvePath"
import { firstValueFrom, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFText } from "vdf-documentsymbols"
import { type InlayHint } from "vscode-languageserver"
import { BaseDocument } from "../../BaseDocument"
import { Collection, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, type DiagnosticsContext } from "../../DiagnosticFactory"
import type { DocumentLinkResolve, PartialDiagnosticCodeActionReference } from "../../TextDocumentBase"
import type { Dependencies, Globals, VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"
import { transform } from "./VGUISchema"

interface GameMenuDiagnosticsContext extends DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols> {
	image: Map<string, PartialDiagnosticCodeActionReference[]>
}

const definitionTypes = [
	{ type: types.string, keys: new Set(["label", "tooltip"]) }
]

export const GameMenuSchema = (document: VDFTextDocument) => {

	const base = new BaseDocument(document)
	const d = DiagnosticFactory<GameMenuDiagnosticsContext, Dependencies, Globals>(document, KeyDistinct.First, transform)

	const token = d.string(d.reference(types.string, "languageTokens"))
	const image = d.file("image", "materials/vgui", ".vmt")
	const style = d.string(d.set(["0", "1", "2"]))
	const bool = d.string(d.set(["0", "1"]))

	const getDiagnostics = d.header(
		d.record(
			d.documentSymbols({
				"label": token,
				"command": d.string(),
				"tooltip": token,
				"subimage": d.string(image.validate),
				"style": style,
				"OnlyInGame": bool,
				"OnlyInReplay": bool,
				"OnlyAtMenu": bool,
				"OnlyWhenVREnabled": bool,
			})
		)
	)

	return {
		id: <const>"game-menu",
		name: <const>"Game Menu",
		definitionTypes: definitionTypes,
		content$: document.documentSymbols$.pipe(
			base.combineLatestBaseDefinitions((rest) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				for (const documentSymbol of rest[0]?.children ?? new VDFDocumentSymbols()) {
					documentSymbol.children?.forAll((documentSymbol) => {
						if (documentSymbol.value) {
							const key = transform(documentSymbol.key.text)

							for (const { type, keys } of definitionTypes) {
								if (keys.has(key) && type.test(documentSymbol.value.text)) {
									references.set(null, type, type.toDefinition(documentSymbol.value.text), documentSymbol.value)
								}
							}
						}
					})
				}

				return {
					scopes: scopes,
					definitions: definitions,
					references: references,
				}
			})
		),
		getDiagnostics: (diagnostics, context) => {
			const schemaContext = { ...context, image: new Map<string, PartialDiagnosticCodeActionReference[]>() }
			base.getDiagnostics(diagnostics, schemaContext)
			getDiagnostics(diagnostics, schemaContext)
			image.connect(diagnostics, schemaContext)
		},
		getDocumentLinks: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()

			return header.reduce(
				(documentLinks, documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (transform(documentSymbol.key.text)) {
							case "subimage": {
								if (documentSymbol.value?.text.trim().length) {
									documentLinks.push({
										range: documentSymbol.value.range!,
										data: {
											resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(`materials/vgui/${documentSymbol.value?.text}`, ".vmt")))).uri
										}
									})
								}
								break
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
			const definitions = await firstValueFrom(document.data$.pipe(switchMap((data) => data.globals.get("languageTokens").definitions$)))
			const references = document.references.collection$.value

			return references
				.ofType(null, types.string)
				.entries()
				.flatMap(([key, references]) => {
					const definition = definitions.get(null, types.string, key)
					if (!definition) {
						return []
					}

					return references
						.values()
						.filter((reference) => params.range.contains(reference.range))
						.map((reference) => {
							return <InlayHint>{
								position: reference.range.end,
								label: [definition[0].inlayHintLabel!],
								paddingLeft: true,
							}
						})
				})
				.toArray()
		},
		completion: {
			keys: async (params, path, token) => {
				switch (path.length) {
					case 0: {
						return {
							before: base.completionBaseKeys(params, token),
							cls: {
								one: [
									"GameMenu"
								]
							}
						}
					}
					case 1: {
						return {
							cls: {
								one: (await firstValueFrom(document.workspace.elements("resource/ui/mainmenuoverride.res")))
									.definitions
									.ofType(null, types.element)
									.values()
									.map((definition) => definition[0].key)
									.toArray()
							}
						}
					}
					case 2: {
						return {
							field: {
								one: [
									"label",
									"command",
									"tooltip",
									"subimage",
									"style",
									"OnlyInGame",
									"OnlyInReplay",
									"OnlyAtMenu",
									"OnlyWhenVREnabled",
								]
							}
						}
					}
					default: {
						return null
					}
				}
			},
			values: async (params, path, key, token) => {
				key = key.toLowerCase()
				if (key == "#base") {
					return await base.completionBaseValues(params, token)
				}

				switch (key.toLowerCase()) {
					case "label":
					case "tooltip": {
						const definitions = (await firstValueFrom(document.data$.pipe(switchMap((data) => data.globals.get("languageTokens").definitions$)))).ofType(null, types.string)

						return {
							length: definitions.size,
							items: definitions
								.values()
								.map((definition) => definition[0].completionItem)
						}
					}
					case "subimage": {
						return await params.files({
							folder: "materials/vgui",
							params: params,
							token: token,
							basenamePattern: "*.vmt",
							map: "name",
							image: true
						})
					}
					case "OnlyInGame".toLowerCase():
					case "OnlyInReplay".toLowerCase():
					case "OnlyAtMenu".toLowerCase():
					case "OnlyWhenVREnabled".toLowerCase(): {
						return params.bits()
					}
					default: {
						return null
					}
				}
			},
		}
	} satisfies VDFTextDocumentSchema
}
