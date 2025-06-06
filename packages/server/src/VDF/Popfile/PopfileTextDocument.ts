import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { combineLatest, combineLatestWith, from, map, shareReplay, zip, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { type VDFDocumentSymbol, type VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, CompletionItem, CompletionItemKind, DiagnosticSeverity, InlayHint, InlayHintKind, InsertTextFormat } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TextDocumentInit } from "../../TextDocumentBase"
import { VDFTextDocument, VGUIAssetType, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import type { PopfileWorkspace } from "./PopfileWorkspace"
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
				scope: "Wave".toLowerCase(),
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

	private readonly workspace: PopfileWorkspace
	public readonly inlayHints$: Observable<InlayHint[]>
	public readonly decorations$: Observable<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, PopfileTextDocument>,
		workspace: PopfileWorkspace
	) {
		super(init, documentConfiguration, fileSystem, documents, {
			relativeFolderPath: "scripts/population",
			VDFParserOptions: { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) },
			keyTransform: (key) => key,
			writeRoot: null,
			dependencies$: combineLatest([
				zip([workspace.items$, workspace.attributes$, workspace.paints$]),
				from(workspace.entities(init.uri.basename())),
			]).pipe(
				map(([[items, attributes, paints], entities]) => {
					return {
						schema: {
							...PopfileTextDocument.Schema,
							keys: {
								...PopfileTextDocument.Schema.keys,
								...items.keys,
								...attributes.keys
							},
							values: {
								...PopfileTextDocument.Schema.values,
								...items.values,
								...attributes.values,
								...entities?.values
							},
							colours: {
								...PopfileTextDocument.Schema.colours,
								completion: {
									presets: paints
										.entries()
										.map(([value, name]): CompletionItem => {
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
										.toArray()
								}
							},
							completion: {
								...PopfileTextDocument.Schema.completion,
								values: {
									...entities?.completion.values
								}
							}
						} satisfies VDFTextDocumentSchema,
						globals: []
					}
				})
			)
		})

		this.workspace = workspace

		this.inlayHints$ = this.documentSymbols$.pipe(
			combineLatestWith(workspace.paints$),
			map(([documentSymbols, paints]) => {
				return documentSymbols.reduceRecursive(
					[] as InlayHint[],
					(inlayHints, documentSymbol) => {
						if (documentSymbol.key.toLowerCase() == "set item tint rgb".toLowerCase() && documentSymbol.detailRange) {
							if (paints.has(documentSymbol.detail!)) {
								inlayHints.push({
									position: documentSymbol.detailRange.end,
									label: paints.get(documentSymbol.detail!)!,
									kind: InlayHintKind.Type,
									paddingLeft: true
								})
							}
						}
						return inlayHints
					}
				)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
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

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions, scopes: Map<symbol, Map<number | null, VDFRange>>): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null> {
		const key = documentSymbol.key.toLowerCase()

		// https://github.com/cooolbros/vscode-vdf/issues/33
		if ((key == "Squad".toLowerCase()) && path.at(-1)?.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children && documentSymbol.children.length == 1 && this.configuration.keyTransform(documentSymbol.children[0].key.toLowerCase()) == "TFBot".toLowerCase()) {
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
			const scope = scopes.get(waveSpawnType)?.entries().find(([scope, range]) => range.contains(documentSymbol.range))?.[0] ?? null
			for (const waveSpawnDefinition of definitions.get(scope, waveSpawnType, documentSymbol.detail) ?? []) {
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

		// https://github.com/cooolbros/vscode-vdf/issues/62
		if (key == "ClassIcon".toLowerCase() && documentSymbol.detail) {
			return this.workspace.classIconFlags(documentSymbol.detail).pipe(
				map((vtf) => {
					if (!vtf) {
						return null
					}

					const noMip = (vtf.flags & 256) == 256
					const noLod = (vtf.flags & 512) == 512

					if (noMip && noLod) {
						return null
					}

					return {
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Warning,
						code: "missing-vtf-flags",
						source: "popfile",
						message: `ClassIcon '${documentSymbol.detail}' does not set VTF flag${!noMip && !noLod ? "s" : ""} ${!noMip ? `"No Mipmap"` : ""}${!noMip && !noLod ? " and " : ""}${!noLod ? `"No Level Of Detail"` : ""}.`,
						data: {
							kind: CodeActionKind.QuickFix,
							fix: () => {
								return {
									title: `Set VTF flags: "No Mipmap" and "No Level Of Detail".`,
									command: {
										title: "",
										command: "vscode-vdf.setVTFFlags",
										arguments: [vtf.uri, 256 | 512]
									}
								}
							},
						}
					} satisfies DiagnosticCodeAction

				})
			)

		}

		return null
	}
}
