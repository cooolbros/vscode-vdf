import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import type { WatchEvent } from "common/WatchEvent"
import { combineLatest, defer, from, map, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { Definitions } from "../../DefinitionReferences"
import { type TextDocumentInit } from "../../TextDocumentBase"
import { VDFTextDocument, type VDFTextDocumentDependencies } from "../VDFTextDocument"
import type { PopfileWorkspace } from "./PopfileWorkspace"
import { BasePopfileSchema } from "./schemas/BasePopfileSchema"
import { MissionPopfileSchema } from "./schemas/MissionPopfileSchema"

export interface PopfileTextDocumentDependencies extends VDFTextDocumentDependencies {
	classIcons: Map<string, VDFRange[]>
	bsp: `mvm_${string}.bsp` | null
	events: Map<string, string>
	game_sounds: Definitions
}

export class PopfileTextDocument extends VDFTextDocument<PopfileTextDocument, PopfileTextDocumentDependencies> {

	public readonly workspace: PopfileWorkspace
	public readonly decorations$: Observable<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		watch: (uri: Uri) => Observable<WatchEvent>,
		documents: RefCountAsyncDisposableFactory<Uri, PopfileTextDocument>,
		workspace: PopfileWorkspace
	) {
		super(init, documentConfiguration, fileSystem, watch, documents, {
			relativeFolderPath: "scripts/population",
			VDFParserOptions: { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) },
			keyTransform: (key) => key,
			dependencies$: combineLatest([
				defer(async () => {
					const schema = init.uri.basename().startsWith("mvm_")
						? MissionPopfileSchema
						: BasePopfileSchema

					return schema(this)
				}),
				from(workspace.game_sounds),
				from(workspace.dependencies),
				from(workspace.entities(init.uri)),
			]).pipe(
				map(([schema, game_sounds, workspace, entities]) => {
					return {
						schema: {
							...schema,
							keys: {
								...schema.keys,
								...workspace.schema.keys,
								...entities?.schema.keys,
							},
							values: {
								...schema.values,
								...workspace.schema.values,
								...entities?.schema.values
							},
							completion: {
								...schema.completion,
								values: {
									...schema.completion.values,
									...workspace.completion.values,
									...entities?.schema.completion.values,
								}
							}
						},
						globals$: workspace.globals$,
						classIcons: new Map(),
						bsp: entities?.bsp ?? null,
						events: entities?.events ?? new Map([["default", "Default"]]),
						game_sounds: game_sounds.definitions,
					} satisfies PopfileTextDocumentDependencies
				})
			)
		})

		this.workspace = workspace

		this.decorations$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key != "#base" && documentSymbol)?.children
				if (!waveSchedule) {
					return []
				}

				return waveSchedule.reduce(
					(decorations, documentSymbol) => {
						if (documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined) {
							const currency = documentSymbol.children.reduce(
								(currency, documentSymbol) => {
									if (documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
										const totalCurrency = parseInt(documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCurrency".toLowerCase())?.detail ?? "")
										if (!isNaN(totalCurrency)) {
											currency += totalCurrency
										}
									}
									return currency
								},
								0
							)

							decorations.push({
								range: documentSymbol.nameRange,
								renderOptions: {
									after: {
										contentText: `${decorations.length + 1} $${currency}`
									}
								}
							})
						}
						return decorations
					},
					<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>[]
				)
			})
		)
	}
}
