import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, concatMap, from, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { type VDFDocumentSymbol, type VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, CompletionItem, CompletionItemKind, DiagnosticSeverity, InlayHint, InlayHintKind, InsertTextFormat } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import { VDFTextDocument, VGUIAssetType, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import colours from "./colours.json"
import keys from "./keys.json"
import values from "./values.json"

export class PopfileTextDocument extends VDFTextDocument<PopfileTextDocument> {

	public static readonly Schema: VDFTextDocumentSchema = {
		keys: keys,
		values: values,
		definitionReferences: [
			{
				type: Symbol.for("template"),
				definition: {
					match: (documentSymbol, path) => {
						if (documentSymbol.children != undefined && path.length == 2 && path.at(-1)!.key.toLowerCase() == "Templates".toLowerCase()) {
							return {
								key: documentSymbol.key,
								keyRange: documentSymbol.nameRange,
							}
						}
					}
				},
				reference: {
					keys: new Set(["Template".toLowerCase()]),
					match: null
				}
			},
			{
				type: Symbol.for("wavespawn"),
				definition: {
					match: (documentSymbol, path) => {
						if (documentSymbol.children != undefined && path.length == 2 && documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && path.at(-1)!.key.toLowerCase() == "Wave".toLowerCase()) {
							const name = documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Name".toLowerCase())
							if (name && name.detail != undefined) {
								return {
									key: name.detail,
									keyRange: name.detailRange!,
								}
							}
						}
					}
				},
				reference: {
					keys: new Set([
						"WaitForAllSpawned".toLowerCase(),
						"WaitForAllDead".toLowerCase()
					]),
					match: null
				}
			}
		],
		files: [
			{
				name: "class icon",
				parentKeys: [],
				keys: new Set([
					"ClassIcon".toLowerCase()
				]),
				folder: "materials/hud",
				extensionsPattern: ".vmt",
				resolveBaseName: (value, withExtension) => `leaderboard_class_${withExtension(".vmt")}`,
				toCompletionItem: (name, type, withoutExtension) => {
					if (type == 1 && name.startsWith("leaderboard_class_")) {
						const insertText = withoutExtension().substring("leaderboard_class_".length)
						return {
							label: name.substring("leaderboard_class_".length),
							insertText: insertText,
						}
					}
					else {
						return null
					}
				},
				asset: VGUIAssetType.Image
			},
			{
				name: "sound",
				parentKeys: [],
				keys: new Set([
					"DoneWarningSound".toLowerCase(),
					"FirstSpawnWarningSound".toLowerCase(),
					"LastSpawnWarningSound".toLowerCase(),
					"Sound".toLowerCase(),
					"StartWaveWarningSound".toLowerCase(),
				]),
				folder: "sound",
				extensionsPattern: null,
				resolveBaseName: (value, withExtension) => value,
			}
		],
		colours: {
			keys: {
				include: new Set(["set item tint rgb"]),
				exclude: null
			},
			colours: [
				{
					pattern: /\d+/,
					parse(value) {
						const colour = parseInt(value)
						return {
							red: ((colour >> 16) & 255) / 255,
							green: ((colour >> 8) & 255) / 255,
							blue: ((colour >> 0) & 255) / 255,
							alpha: 255
						}
					},
					stringify(colour) {
						return (colour.red * 255 << 16 | colour.green * 255 << 8 | colour.blue * 255 << 0).toString()
					}
				}
			],
			completion: {
				presets: Object.entries(colours).map(([value, name]): CompletionItem => {
					const colour = parseInt(value)
					const r = (colour >> 16) & 255
					const g = (colour >> 8) & 255
					const b = (colour >> 0) & 255
					return {
						label: value,
						labelDetails: {
							description: name
						},
						kind: CompletionItemKind.Color,
						documentation: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
						filterText: name,
						insertText: value,
					}
				})
			}
		},
		completion: {
			root: [
				{
					label: "WaveSchedule",
					kind: CompletionItemKind.Class,
					preselect: true,
					insertText: "WaveSchedule\n{\n\t$0\n}",
					insertTextFormat: InsertTextFormat.Snippet
				}
			],
			typeKey: null,
			defaultType: null,
		}
	}

	private static readonly lengths = {
		["Param".toLowerCase()]: 4096,
		["Tag".toLowerCase()]: 256,
	}

	public readonly inlayHints$: Observable<InlayHint[]>
	public readonly decorations$: Observable<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<PopfileTextDocument>,
		getEntities: (uri: Uri) => Promise<Record<string, string>[] | null>,
		refCountDispose: (dispose: () => void) => void,
	) {
		super(init, documentConfiguration, fileSystem$, documents, refCountDispose, {
			relativeFolderPath: "scripts/population",
			VDFParserOptions: { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) },
			keyTransform: (key) => key,
			dependencies$: fileSystem$.pipe(
				switchMap((fileSystem) => {
					return combineLatest({
						items: fileSystem.resolveFile("scripts/items/items_game.txt").pipe(
							concatMap(async (uri) => documents.get(uri!, true)),
							switchMap((document) => document.documentSymbols$),
							map((documentSymbols) => {
								const items_game = documentSymbols.find((documentSymbol) => documentSymbol.key == "items_game")

								function names(key: string) {
									return items_game
										?.children
										?.find((documentSymbol) => documentSymbol.key == key)
										?.children
										?.values()
										.map((documentSymbol) => documentSymbol.children?.find((documentSymbol) => documentSymbol.key == "name")?.detail)
										.filter((name) => name != undefined)
								}

								return {
									items: names("items") ?? Iterator.from([]),
									attributes: names("attributes") ?? Iterator.from([]),
								}
							}),
						),
						entities: from(fileSystem.readDirectory("maps", { pattern: "mvm_*.bsp" })).pipe(
							map((maps) => {
								const basename = this.uri.basename()
								return maps
									.values()
									.filter(([, type]) => type == 1)
									.find(([name]) => basename.startsWith(posix.parse(name).name))?.[0]
							}),
							switchMap((bsp) => {
								if (!bsp) {
									return of(null)
								}

								return fileSystem.resolveFile(`maps/${bsp}`).pipe(
									concatMap(async (uri) => {
										if (!uri) {
											return null
										}

										const entities = await getEntities(uri)
										if (!entities) {
											return null
										}

										return Map.groupBy(entities, (item) => item["classname"])
									}),
									map((entities) => {
										if (!entities) {
											return null
										}

										// Where
										const teamSpawns = [
											...new Set(
												entities
													?.get("info_player_teamspawn")
													?.toSorted((a, b) => b["TeamNum"]?.localeCompare(a["TeamNum"]) || a["targetname"]?.localeCompare(b["targetname"]))
													.values()
													.map((entity) => entity["targetname"])
													.filter((targetname) => targetname != undefined)
											),
											"Ahead",
											"Behind",
											"Anywhere",
											""
										]

										// StartingPathTrackNode
										const pathTracks = [
											...new Set(
												entities
													?.get("path_track")
													?.values()
													.filter((entity) => !entities.get("path_track")!.some((e) => e["target"] == entity["targetname"]))
													.map((entity) => entity["targetname"])
													.filter((targetname) => targetname != undefined)
											)
										].toSorted()

										// Target
										const targets = [
											...new Set(
												entities
													?.values()
													?.flatMap((value) => value)
													.map((entity) => entity["targetname"])
													.filter((targetname) => targetname != undefined && !targetname.startsWith("//"))
											),
											"BigNet"
										].toSorted()

										return { teamSpawns, pathTracks, targets }
									})
								)
							})
						)
					})
				}),
				map(({ items: { items, attributes }, entities }) => {
					const attributesItems = attributes.map((name) => ({ label: name, kind: CompletionItemKind.Field })).toArray()

					// Drop "default"
					const itemsItems = items.drop(1).toArray()

					return {
						schema: {
							...PopfileTextDocument.Schema,
							keys: {
								...PopfileTextDocument.Schema.keys,
								characterattributes: {
									values: attributesItems
								},
								itemattributes: {
									values: [
										{
											label: "ItemName",
											kind: CompletionItemKind.Field
										},
										...attributesItems
									]
								}
							},
							values: {
								...PopfileTextDocument.Schema.values,
								item: {
									kind: CompletionItemKind.Constant,
									values: itemsItems
								},
								itemname: {
									kind: CompletionItemKind.Constant,
									values: itemsItems
								},
								...(entities && {
									[`${"ClosestPoint".toLowerCase()}`]: {
										kind: CompletionItemKind.Enum,
										values: entities.teamSpawns
									},
									[`${"Where".toLowerCase()}`]: {
										kind: CompletionItemKind.Enum,
										values: entities.teamSpawns
									}
								})
							},
							completion: {
								...PopfileTextDocument.Schema.completion,
								values: {
									...(entities && {
										startingpathtracknode: {
											kind: CompletionItemKind.Enum,
											values: entities.pathTracks
										},
										target: {
											kind: CompletionItemKind.Enum,
											values: entities.targets
										},
									}),
								}
							}
						},
						globals: []
					} satisfies VDFTextDocumentDependencies
				})
			),
		})

		this.inlayHints$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols.reduceRecursive(
					[] as InlayHint[],
					(inlayHints, documentSymbol) => {
						if (documentSymbol.key.toLowerCase() == "set item tint rgb".toLowerCase() && documentSymbol.detailRange) {
							if (((detail): detail is keyof typeof colours => detail in colours)(documentSymbol.detail!)) {
								inlayHints.push({
									position: documentSymbol.detailRange.end,
									label: colours[documentSymbol.detail!],
									kind: InlayHintKind.Type,
									paddingLeft: true
								})
							}
						}
						return inlayHints
					}
				)
			}),
			shareReplay(1)
		)

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
										const totalCurrency = parseInt(documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCurrency".toLowerCase())?.detail ?? "")
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

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null> {
		const key = documentSymbol.key.toLowerCase()

		// https://github.com/cooolbros/vscode-vdf/issues/33
		if ((key == "Squad".toLowerCase()) && documentSymbol.children && documentSymbol.children.length == 1 && this.configuration.keyTransform(documentSymbol.children[0].key.toLowerCase()) == "TFBot".toLowerCase()) {
			return {
				range: documentSymbol.range,
				severity: DiagnosticSeverity.Warning,
				code: "useless-squad",
				source: "popfile",
				message: "Squad with 1 TFBot is useless.",
				data: {
					kind: CodeActionKind.QuickFix,
					fix: ({ createDocumentWorkspaceEdit }) => {
						return {
							title: `Replace Squad with TFBot`,
							edit: createDocumentWorkspaceEdit(documentSymbol.range, this.document.getText(documentSymbol.children![0]!.range))
						}
					},
				}
			}
		}

		if (key == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {

			// https://github.com/cooolbros/vscode-vdf/issues/34
			const maxActive = parseInt(documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "MaxActive".toLowerCase())?.detail ?? "")
			const spawnCount = parseInt(documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "SpawnCount".toLowerCase())?.detail ?? "")
			if (!isNaN(maxActive) && !isNaN(spawnCount) && spawnCount > maxActive) {
				return {
					range: documentSymbol.nameRange,
					severity: DiagnosticSeverity.Warning,
					code: "wavespawn-softlock",
					source: "popfile",
					message: `WaveSpawn with MaxActive ${maxActive} and SpawnCount ${spawnCount} will cause softlock`,
				}
			}
			else {
				return null
			}
		}

		// https://github.com/cooolbros/vscode-vdf/issues/35
		const waveSpawnType = Symbol.for("wavespawn")
		if (PopfileTextDocument.Schema.definitionReferences.find(({ type }) => type == waveSpawnType)!.reference!.keys.has(key) && documentSymbol?.detail != undefined) {
			for (const waveSpawnDefinition of definitions.get(Symbol.for("wavespawn"), documentSymbol.detail) ?? []) {
				const waveSpawnDocumentSymbol = documentSymbols.getDocumentSymbolAtPosition(waveSpawnDefinition.range.start)!
				const support = waveSpawnDocumentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Support".toLowerCase())?.detail
				if (support != undefined && !["0", "Limited".toLowerCase()].includes(support.toLowerCase())) {
					return {
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Warning,
						code: "wavespawn-softlock",
						source: "popfile",
						message: `${documentSymbol.key} '${documentSymbol.detail}' will cause softlock because ${waveSpawnDefinition.key} has Support '${support}'`,
					}
				}
			}

			return null
		}

		if (key == "ItemAttributes".toLowerCase() && documentSymbol.children) {
			const itemName = documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "ItemName".toLowerCase() && documentSymbol.detail != undefined)
			if (!itemName) {
				return {
					range: documentSymbol.nameRange,
					severity: DiagnosticSeverity.Warning,
					code: "missing-itemname",
					source: "popfile",
					message: "ItemAttributes block must include Itemname (TFBotSpawner: need to specify ItemName in ItemAttributes.)",
				}
			}
		}

		// https://github.com/cooolbros/vscode-vdf/issues/29
		// https://github.com/cooolbros/vscode-vdf/pull/72
		const lengths = PopfileTextDocument.lengths
		if (key in lengths && documentSymbol.detail != undefined) {
			const length = documentSymbol.detail.length + "\0".length
			if (length >= lengths[key]) {
				return {
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-length",
					source: "popfile",
					message: `Value exceeds maximum buffer size (Max: ${lengths[key]}, Size: ${length}).`,
				}
			}
		}

		return null
	}
}
