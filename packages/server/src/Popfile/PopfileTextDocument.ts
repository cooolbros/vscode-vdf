import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import { usingAsync } from "common/operators/usingAsync"
import { missionSpawnKeys } from "common/popfile/missionSpawnKeys"
import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { resolvePath } from "common/resolvePath"
import { removeSoundChars } from "common/soundChars"
import { Uri } from "common/Uri"
import { type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, connectable, defer, finalize, firstValueFrom, map, Observable, of, ReplaySubject, share, switchMap, type Connectable } from "rxjs"
import { VDFIndentation, VDFNewLine, VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol, type VDFText } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { formatVDF, quote, type VDFFormatStringifyOptions } from "vdf-format"
import { BulkRegistration, CompletionItemKind, DiagnosticSeverity, FoldingRange, FoldingRangeKind, FoldingRangeRequest, InlayHintKind, InsertTextFormat, MarkupKind, SignatureHelpRequest, TextDocumentContentRequest, TextEdit, type CodeLens, type CodeLensParams, type CompletionItem, type CompletionList, type CompletionParams, type Connection, type DefinitionLink, type DefinitionParams, type DocumentFormattingParams, type FoldingRangeParams, type Hover, type HoverParams, type InlayHint, type Location, type PrepareRenameParams, type PrepareRenamePlaceholder, type ReferenceParams, type RenameParams, type SignatureHelp, type SignatureHelpParams, type WorkspaceEdit } from "vscode-languageserver"
import { BaseDocument } from "../BaseDocument"
import { Collection, type Definition, type Definitions } from "../DefinitionReferences"
import { types, type DefinitionType } from "../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, unknown, type DiagnosticsContext, type RefineReference, type RefineString, type Validate } from "../DiagnosticFactory"
import type { ColourInformationStringify, Decoration, DiagnosticCodeAction, DocumentLinkResolve, PartialDiagnosticCodeActionReference, TextDocumentDiagnosticsParams, TextDocumentInit, VDFCompletionItem, VDFCompletionList, VDFCompletionParams } from "../TextDocumentBase"
import { TextDocumentBase } from "../TextDocumentBase"
import { VDFTextDocument } from "../VDF/VDFTextDocument"
import type { TextDocument, VDFLanguageServer } from "../VDFLanguageServer"
import type { BSP, GlobalDefinitionReferences, VDFWorkspace } from "../VDFWorkspace"
import keys from "./keys.json"
import values from "./values.json"

const waveEvents = new Set([
	"DoneOutput".toLowerCase(),
	"InitWaveOutput".toLowerCase(),
	"StartWaveOutput".toLowerCase(),
])

const set_item_tint_rgb: Lowercase<"set item tint RGB"> = "set item tint rgb"
const set_item_tint_rgb_2: Lowercase<"set item tint RGB 2"> = "set item tint rgb 2"

const attach_particle_effect = "attach particle effect"
const attach_particle_effect_static = "attach particle effect static"

const sounds = new Set([
	"DoneWarningSound".toLowerCase(),
	"FirstSpawnWarningSound".toLowerCase(),
	"LastSpawnWarningSound".toLowerCase(),
	"Sound".toLowerCase(),
	"StartWaveWarningSound".toLowerCase(),
])

function collectTFBotItems(path: VDFDocumentSymbol[], definitions: Definitions) {
	const collectTemplateAttributes = (detail: string, definitions: Definitions, seen: Set<string>): { TFClass?: string, items: string[] } => {
		const definition = definitions.get(null, types.template, detail)
		if (!definition || !definition.length) {
			return { TFClass: undefined, items: [] }
		}

		const data = <{ template?: string, TFClass?: string, items: string[] }>definition[0].data
		const { template, items } = data
		let TFClass = data.TFClass

		if (template != undefined && !seen.has(template.toLowerCase())) {
			seen.add(template.toLowerCase())
			const result = collectTemplateAttributes(template, definitions, seen)
			TFClass ??= result.TFClass
			items.push(...result.items)
		}

		return {
			TFClass,
			items
		}
	}

	const parent = path.at(-3)
	if (!parent) {
		return null
	}

	let TFBot: VDFDocumentSymbols | undefined
	let defaultAttributes: VDFDocumentSymbols | undefined
	let currentAttributes: VDFDocumentSymbols | undefined

	if (parent.key.text.toLowerCase() == "EventChangeAttributes".toLowerCase()) {
		TFBot = path.at(-4 /* * => EventChangeAttributes => * => ItemAttributes */)?.children
		defaultAttributes = parent.children?.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Default".toLowerCase())?.children
		currentAttributes = path.at(-2)!.children
	}
	else {
		TFBot = path.at(-2 /* TFBot => ItemAttributes */)?.children
		defaultAttributes = undefined
		currentAttributes = undefined
	}

	if (!TFBot) {
		return null
	}

	const items: string[] = []
	const botItems: string[] = []
	const templateItems: string[] = []

	let TFBotClass = TFBot.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Class".toLowerCase())?.value?.text
	const template = TFBot.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Template".toLowerCase())

	for (const documentSymbol of TFBot) {
		if (documentSymbol == template) {
			if (template.value == undefined) {
				continue
			}

			const { TFClass, items } = collectTemplateAttributes(template.value.text, definitions, new Set([template.value.text.toLowerCase()]))
			TFBotClass ??= TFClass
			templateItems.push(...items)
		}
		else if (documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() && documentSymbol.value != undefined) {
			botItems.push(documentSymbol.value.text)
		}
	}

	// Use case sensitive class name for diagnostic message instead of case insensitive user defined key
	let canonicalClassName = undefined

	if (TFBotClass != undefined) {
		switch (TFBotClass.toLowerCase()) {
			// Offense
			case "Scout".toLowerCase():
				canonicalClassName = "Scout"
				items.push("TF_WEAPON_SCATTERGUN", "TF_WEAPON_PISTOL_SCOUT", "TF_WEAPON_BAT")
				break
			case "Soldier".toLowerCase():
				canonicalClassName = "Soldier"
				items.push("TF_WEAPON_ROCKETLAUNCHER", "TF_WEAPON_SHOTGUN_SOLDIER", "TF_WEAPON_SHOVEL")
				break
			case "Pyro".toLowerCase():
				canonicalClassName = "Pyro"
				items.push("TF_WEAPON_FLAMETHROWER", "TF_WEAPON_SHOTGUN_PYRO", "TF_WEAPON_FIREAXE")
				break
			// Defense
			case "Demoman".toLowerCase():
				canonicalClassName = "Demoman"
				items.push("TF_WEAPON_GRENADELAUNCHER", "TF_WEAPON_PIPEBOMBLAUNCHER", "TF_WEAPON_BOTTLE")
				break
			case "Heavy".toLowerCase():
			case "Heavyweapons".toLowerCase():
				canonicalClassName = "Heavyweapons"
				items.push("TF_WEAPON_MINIGUN", "TF_WEAPON_SHOTGUN_HWG", "TF_WEAPON_FISTS")
				break
			case "Engineer".toLowerCase():
				canonicalClassName = "Engineer"
				items.push("TF_WEAPON_SHOTGUN_PRIMARY", "TF_WEAPON_PISTOL", "TF_WEAPON_WRENCH", "TF_WEAPON_PDA_ENGINEER_BUILD", "TF_WEAPON_PDA_ENGINEER_DESTROY")
				break
			// Support
			case "Medic".toLowerCase():
				canonicalClassName = "Medic"
				items.push("TF_WEAPON_SYRINGEGUN_MEDIC", "TF_WEAPON_MEDIGUN", "TF_WEAPON_BONESAW")
				break
			case "Sniper".toLowerCase():
				canonicalClassName = "Sniper"
				items.push("TF_WEAPON_SNIPERRIFLE", "TF_WEAPON_SMG", "TF_WEAPON_CLUB")
				break
			case "Spy".toLowerCase():
				canonicalClassName = "Spy"
				items.push("TF_WEAPON_REVOLVER", "TF_WEAPON_BUILDER_SPY", "TF_WEAPON_KNIFE", "TF_WEAPON_PDA_SPY", "TF_WEAPON_INVIS")
				break
		}
	}

	if (defaultAttributes != undefined) {
		const defaultItems = defaultAttributes
			.values()
			.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() && documentSymbol.value != undefined)
			.map((documentSymbol) => documentSymbol.value!.text)
			.toArray()
		botItems.push(...defaultItems)
	}

	if (currentAttributes != undefined && currentAttributes != defaultAttributes) {
		const currentItems = currentAttributes
			.values()
			.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() && documentSymbol.value != undefined)
			.map((documentSymbol) => documentSymbol.value!.text)
			.toArray()
		botItems.push(...currentItems)
	}

	items.push(...botItems)
	items.push(...templateItems)

	return {
		canonicalClassName,
		items,
	}
}

// Popfile Diagnostics
interface PopfileTextDocumentDiagnosticsContext extends DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols> {
	classIcons: Map<string, PartialDiagnosticCodeActionReference[]>
	sound: Map<string, PartialDiagnosticCodeActionReference[]>
	conditional?: string | null
}

type D = ReturnType<typeof DiagnosticFactory<PopfileTextDocumentDiagnosticsContext, Dependencies, Globals>>

interface PopfileSchema {
	TemplatesDistinct: KeyDistinct
	getTemplates(documentSymbols: VDFDocumentSymbols): IteratorObject<VDFDocumentSymbol>
	validateClassIcon(d: D): RefineString<PopfileTextDocumentDiagnosticsContext>
	validateEventName(d: D): Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext>
	validateTemplateReference(d: D): RefineReference<PopfileTextDocumentDiagnosticsContext>
}

const MissionSchema: PopfileSchema = {
	TemplatesDistinct: KeyDistinct.First,
	getTemplates: function*(documentSymbols: VDFDocumentSymbols) {
		const templatesBlock = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Templates".toLowerCase())
		const seen = new Set<string>()
		for (const template of templatesBlock?.children ?? []) {
			const key = template.key.text.toLowerCase()
			if (seen.has(key)) {
				continue
			}
			seen.add(key)

			yield template
		}
	},
	validateClassIcon: (_d) => {
		return (name, detail, documentSymbol, path, diagnostics, context) => {
			context.classIcons.getOrInsertComputed(detail.text, () => []).push({
				index: diagnostics.length,
				range: detail.range,
				name: "ClassIcon",
				detail: detail.text,
			})

			diagnostics.push(undefined)
		}
	},
	validateEventName: (d) => {
		return (name, value, path, diagnostics, context) => {
			const events = context.dependencies.bsp?.events ?? PopfileTextDocument.events
			const eventName = events.get(value.key.text.toLowerCase())
			if (eventName == undefined) {
				diagnostics.push({
					range: value.key.range,
					severity: DiagnosticSeverity.Warning,
					code: "unknown-event",
					source: "popfile",
					message: `Unknown event '${value.key.text}'. Expected '${[...events.values()].join("' | '")}'`,
					data: {
						fix: ({ params: _params, createDocumentWorkspaceEdit }) => {
							const conditional = context.conditional ??= context.content.documentSymbols.findRecursive((documentSymbol) => documentSymbol.conditional != undefined && !TextDocumentBase.conditionals.has(documentSymbol.conditional.toUpperCase()))?.documentSymbol.conditional
							if (!conditional) {
								return null
							}

							return {
								title: `Add ${conditional}`,
								edit: createDocumentWorkspaceEdit(TextEdit.insert((value.value != undefined ? value.range : value.key.range).end, ` ${conditional}`))
							}
						}
					}
				})
			}
			else {
				d.canonical(eventName, value.key, diagnostics)
			}
		}
	},
	validateTemplateReference: (d) => {
		return (name, detail, documentSymbol, path, diagnostics, context, definitions) => {
			const uri = context.dependencies.uri

			const validateTemplateReference = (definition: Definition, seen: Set<string>) => {
				// Dont push diagnostics for Templates declared in current document because they are already checked
				if (Uri.equals(definition.uri, uri)) {
					return
				}

				const template: string | undefined = definition.data.template
				const events: VDFText[] = definition.data.events

				if (template != undefined && !seen.has(template.toLowerCase())) {
					const definitions = context.content.definitionReferences.definitions.get(null, types.template, template) ?? []
					for (const definition of definitions) {
						validateTemplateReference(definition, new Set([...seen, template.toLowerCase()]))
					}
				}

				const bspEvents = context.dependencies.bsp?.events ?? PopfileTextDocument.events

				for (const event of events) {
					const key = event.text.toLowerCase()
					const name = bspEvents.get(key)
					if (name != undefined) {
						d.canonical(name, event, diagnostics)
					}
					else {
						diagnostics.push({
							range: detail.range,
							severity: DiagnosticSeverity.Warning,
							code: "unknown-event",
							source: "popfile",
							message: `Unknown event '${event.text}' in template ${definition.key}. Expected ${[...bspEvents.values()].join(" | ")}`,
							relatedInformation: [
								{
									location: {
										uri: definition.uri.toString(),
										range: event.range
									},
									message: `${event.text} is declared here.`
								}
							],
							data: {
								fix: ({ params: _params, createDocumentWorkspaceEdit }) => {
									const conditional = context.conditional ??= context.content.documentSymbols.findRecursive((documentSymbol) => documentSymbol.conditional != undefined && !TextDocumentBase.conditionals.has(documentSymbol.conditional.toUpperCase()))?.documentSymbol.conditional
									if (!conditional) {
										return null
									}

									return {
										title: `Add ${conditional}`,
										edit: createDocumentWorkspaceEdit(TextEdit.insert((documentSymbol.value != undefined ? documentSymbol.range : documentSymbol.key.range).end, ` ${conditional}`))
									}
								}
							}
						})
					}
				}
			}

			for (const definition of definitions) {
				validateTemplateReference(definition, new Set([definition.key.toLowerCase()]))
			}
		}
	},
}

const BaseSchema: PopfileSchema = {
	TemplatesDistinct: KeyDistinct.None,
	getTemplates: function*(documentSymbols: VDFDocumentSymbols) {
		const templatesBlocks = documentSymbols.values().filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Templates".toLowerCase())
		for (const templatesBlock of templatesBlocks) {
			const seen = new Set<string>()
			for (const template of templatesBlock.children ?? []) {
				const key = template.key.text.toLowerCase()
				if (seen.has(key)) {
					continue
				}
				seen.add(key)

				yield template
			}
		}
	},
	validateClassIcon: (_d) => {
		return (_name, _detail, _documentSymbol, _path, _diagnostics, _context) => {
			// Don't push diagnostics for ClassIcon references in files with no .bsp because the BSP packed ClassIcons are not yet known
		}
	},
	validateEventName: (_d) => {
		return (_name, _value, _path, _diagnostics, _context) => {
			// Don't push diagnostics for event references in files with no .bsp because the valid events are not yet known
		}
	},
	validateTemplateReference: (_d) => {
		return (_name, _detail, _path, _diagnostics, _context) => {
			// Don't push diagnostics for template references in files with no .bsp because the valid events are not yet known
		}
	},
}

export interface Dependencies {
	readonly uri: Uri,
	readonly configuration: VSCodeVDFConfiguration
	readonly bsp: BSP | null
	readonly gameSounds: Definitions
}

interface Globals {
	itemsGame: GlobalDefinitionReferences
	gameSounds: GlobalDefinitionReferences
}

export class PopfileTextDocument extends TextDocumentBase<Dependencies, Globals, VDFDocumentSymbols> {

	private static readonly VDFParserOptions = { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) }
	public static readonly events = new Map([["default", "Default"]])
	private static readonly virtualTextDocumentContents = new Map<string, { uri: Uri, text: string }>()
	private static open = false

	public readonly languageId = <const>"popfile"

	private readonly workspace: VDFWorkspace
	private readonly base: BaseDocument
	public readonly base$: Observable<string[]>
	private readonly schema: PopfileSchema
	private readonly classIcons: Map<string, Observable<{ uri: Uri, flags: number } | null>>

	private readonly virtualUri: Uri
	private readonly virtualDocumentRanges$: Connectable<VDFRange[]>
	private readonly virtualTextDocumentContent$: Connectable<string>

	protected getDiagnostics: (params: TextDocumentDiagnosticsParams<Dependencies, Globals, VDFDocumentSymbols>) => void
	public readonly decorations$: Observable<Decoration[]>

	public constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TextDocument>,
		trpc: TRPCClient<ClientRouter>,
		workspace: VDFWorkspace,
		path: string | null,
	) {
		super(init, documentConfiguration$, fileSystem, documents, trpc, {
			path: path ?? "scripts/population",
			getDocumentSymbols: (text) => getVDFDocumentSymbols(text, PopfileTextDocument.VDFParserOptions),
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			data$: combineLatest({
				schema: defer(async () => this.schema),
				configuration: documentConfiguration$,
				gameSounds: workspace.gameSounds$,
				entities: workspace.entities(init.uri),
			}).pipe(
				map(({ schema, configuration, gameSounds, entities }) => {
					return {
						dependencies: {
							uri: this.uri,
							configuration: configuration,
							bsp: entities,
							gameSounds: gameSounds,
						} satisfies Dependencies,
						definitions: [
							{
								type: types.item,
								keys: new Set(["Template".toLowerCase()]),
							},
							{
								type: types.wavespawn,
								keys: new Set(["WaitForAllSpawned".toLowerCase(), "WaitForAllDead".toLowerCase()]),
							},
							{
								type: types.item,
								keys: new Set(["Item".toLowerCase(), "ItemName".toLowerCase()]),
							},
						],
						globals: {
							itemsGame: { definitions$: workspace.itemsGame$ } satisfies GlobalDefinitionReferences,
							gameSounds: { definitions$: workspace.gameSounds$ } satisfies GlobalDefinitionReferences,
						},
						content$: this.documentSymbols$.pipe(
							this.base.combineLatestBaseDefinitions((rest) => {
								const documentSymbols = rest[0]?.children ?? new VDFDocumentSymbols()

								const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>([
									[
										types.wavespawn,
										new Map(
											documentSymbols
												.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined)
												.map((documentSymbol, index) => [index, [documentSymbol.range]])
										)
									]
								])

								const definitions = new Collection<Definition>()
								const references = new Collection<VDFText>()

								for (const documentSymbol of schema.getTemplates(documentSymbols)) {
									if (!documentSymbol.children) {
										continue
									}

									const documentation = this.definitions.documentation(documentSymbol)
									const templateTemplate = documentSymbol.children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Template".toLowerCase())

									definitions.set(null, types.template, documentSymbol.key.text, {
										uri: this.uri,
										key: documentSymbol.key.text,
										range: documentSymbol.range,
										keyToken: documentSymbol.key,
										nameToken: undefined,
										detail: undefined,
										documentation: { kind: MarkupKind.Markdown, value: documentation },
										conditional: documentSymbol.conditional ?? undefined,
										completionItem: { label: documentSymbol.key.text, kind: CompletionItemKind.Variable, documentation: { kind: MarkupKind.Markdown, value: documentation } },
										data: {
											template: templateTemplate?.value?.text,
											TFClass: documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Class".toLowerCase())?.value?.text,
											items: documentSymbol.children
												.values()
												.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() && documentSymbol.value != undefined)
												.map((documentSymbol) => documentSymbol.value!.text)
												.toArray(),
											events: (documentSymbol.children
												.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "EventChangeAttributes".toLowerCase())
												?.children ?? [])
												.filter((documentSymbol) => documentSymbol.children != undefined)
												.map((documentSymbol) => documentSymbol.key)
										}
									})

									documentSymbol.children.forEach((documentSymbol) => {
										if (!documentSymbol.value) {
											return
										}

										switch (documentSymbol.key.text.toLowerCase()) {
											case "Template".toLowerCase():
												references.set(null, types.template, documentSymbol.value!.text, documentSymbol.value)
												break
											case "Item".toLowerCase():
												references.set(null, types.item, documentSymbol.value!.text, documentSymbol.value)
												break
										}
									})
								}

								for (const [_index, documentSymbol] of documentSymbols.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Mission".toLowerCase()).entries()) {
									const children = documentSymbol.children ?? []
									for (const documentSymbol of children) {
										if (!missionSpawnKeys.includes(documentSymbol.key.text.toLowerCase())) {
											documentSymbol.children?.forAll((documentSymbol) => {
												if (documentSymbol.key.text.toLowerCase() == "Template".toLowerCase() && documentSymbol.value != undefined) {
													references.set(null, types.template, documentSymbol.value.text, documentSymbol.value)
												}
												else if ((documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() || documentSymbol.key.text.toLowerCase() == "ItemName".toLowerCase()) && documentSymbol.value != undefined) {
													references.set(null, types.item, documentSymbol.value.text, documentSymbol.value)
												}
											})
										}
									}
								}

								for (const [index, documentSymbol] of documentSymbols.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Wave".toLowerCase()).entries()) {
									const children = documentSymbol.children ?? []
									for (const documentSymbol of children) {
										const key = documentSymbol.key.text.toLowerCase()

										if (key == "Sound".toLowerCase() && documentSymbol.value != undefined) {
											const { value } = removeSoundChars(documentSymbol.value.text)
											if (gameSounds.get(null, types.gamesound, value)?.length) {
												references.set(null, types.gamesound, value, documentSymbol.value)
											}
										}

										if (key == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
											const name = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Name".toLowerCase())
											if (name?.value != undefined) {
												const documentation = this.definitions.documentation(documentSymbol)
												definitions.set(index, types.wavespawn, name.value.text, {
													uri: this.uri,
													key: name.value.text,
													range: documentSymbol.range,
													keyToken: name.value,
													nameToken: undefined,
													detail: name.value!.text,
													documentation: { kind: MarkupKind.Markdown, value: documentation },
													conditional: documentSymbol.conditional ?? undefined,
													completionItem: {
														label: documentSymbol.key.text,
														kind: CompletionItemKind.Variable,
														documentation: { kind: MarkupKind.Markdown, value: documentation }
													},
													data: {
														support: documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Support".toLowerCase())?.value?.text
													}
												})
											}

											const values = Map.groupBy(
												documentSymbol.children,
												(documentSymbol) => {
													const key = documentSymbol.key.text.toLowerCase()
													if (key == "WaitForAllSpawned".toLowerCase() || key == "WaitForAllDead".toLowerCase()) {
														return "wavespawn"
													}
													else if (sounds.difference(new Set(["Sound".toLowerCase()])).has(key)) {
														return "sound"
													}
													else if (!waveSpawnKeys.includes(documentSymbol.key.text.toLowerCase())) {
														return "spawner"
													}
													else {
														return null
													}
												}
											)

											for (const documentSymbol of values.get("wavespawn") ?? []) {
												if (documentSymbol.value != undefined) {
													references.set(index, types.wavespawn, documentSymbol.value.text, documentSymbol.value)
												}
											}

											for (const spawner of values.get("spawner") ?? []) {
												spawner.children?.forAll((documentSymbol) => {
													if (documentSymbol.key.text.toLowerCase() == "Template".toLowerCase() && documentSymbol.value != undefined) {
														references.set(null, types.template, documentSymbol.value.text, documentSymbol.value)
													}
													else if ((documentSymbol.key.text.toLowerCase() == "Item".toLowerCase() || documentSymbol.key.text.toLowerCase() == "ItemName".toLowerCase()) && documentSymbol.value != undefined) {
														references.set(null, types.item, documentSymbol.value.text, documentSymbol.value)
													}
												})
											}

											for (const sound of values.get("sound") ?? []) {
												if (sound.value) {
													const { value } = removeSoundChars(sound.value.text)
													if (gameSounds.get(null, types.gamesound, value)?.length) {
														references.set(null, types.gamesound, value, sound.value)
													}
												}
											}
										}
									}
								}

								return {
									scopes,
									definitions,
									references
								}
							}),
						)
					}
				})
			)
		})

		this.workspace = workspace
		this.base = new BaseDocument(this)
		this.base$ = this.base.base$
		this.schema = init.uri.basename().startsWith("mvm_") ? MissionSchema : BaseSchema
		this.classIcons = new Map()

		this.virtualUri = this.uri.with({ scheme: "embedded-squirrel", path: `${this.uri.path}.nut` })

		this.virtualDocumentRanges$ = connectable(
			this.documentSymbols$.pipe(
				map((documentSymbols) => {
					const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children
					if (!waveSchedule) {
						return []
					}

					function event(documentSymbol: VDFDocumentSymbol) {
						if (!documentSymbol.children) {
							return []
						}

						const action = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Action".toLowerCase())?.value?.text.toLowerCase()
						if (action != "RunScriptCode".toLowerCase()) {
							return []
						}

						const param = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Param".toLowerCase())
						if (!param?.value?.range) {
							return []
						}

						return [param.value.range]
					}

					function collect(documentSymbol: VDFDocumentSymbol): VDFRange[] {
						if (!documentSymbol.children) {
							return []
						}

						switch (documentSymbol.key.text.toLowerCase()) {
							case "Mob".toLowerCase():
							case "RandomChoice".toLowerCase():
							case "SentryGun".toLowerCase():
							case "Squad".toLowerCase():
								return documentSymbol
									.children
									.flatMap(collect)
							case "Tank".toLowerCase():
								return documentSymbol
									.children
									.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "OnBombDroppedOutput".toLowerCase() || documentSymbol.key.text.toLowerCase() == "OnKilledOutput".toLowerCase())
									.flatMap(event)
							default:
								return []
						}
					}

					return [
						...waveSchedule
							.values()
							.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Mission".toLowerCase())
							.flatMap((documentSymbol) => documentSymbol.children?.flatMap(collect) ?? []),
						...waveSchedule
							.values()
							.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Wave".toLowerCase())
							.flatMap((documentSymbol) => {
								if (!documentSymbol.children) {
									return []
								}

								return documentSymbol
									.children
									.values()
									.flatMap((documentSymbol) => {
										const key = documentSymbol.key.text.toLowerCase()
										if (key == "WaveSpawn".toLowerCase()) {
											return documentSymbol.children?.flatMap(collect) ?? []
										}
										else if (waveEvents.has(key)) {
											return event(documentSymbol)
										}
										else {
											return []
										}
									})
							})
					]
				}),
				shareReplayUntilDisposed(this.dispose$),
			),
			{
				connector: () => new ReplaySubject(1),
				resetOnDisconnect: false
			}
		)

		this.virtualTextDocumentContent$ = connectable(
			this.virtualDocumentRanges$.pipe(
				map((ranges) => {
					const text = this.getText()
					const clear = (text: string) => text.split("\n").map((line) => " ".repeat(line.length)).join("\n")
					const translate = (text: string) => text.replaceAll("`", "\"")

					if (ranges.length == 0) {
						return clear(text)
					}
					else {
						let content = clear(text.slice(0, this.offsetAt(ranges[0]!.start)))
						for (const [index, range] of ranges.entries()) {
							content += translate(this.getText(range))
							const end = index + 1 < ranges.length ? ranges[index + 1].start : undefined
							content += clear(text.slice(this.offsetAt(range.end), end && this.offsetAt(end)))
						}
						return content
					}
				})
			),
			{
				connector: () => new ReplaySubject(1),
				resetOnDisconnect: false
			}
		)

		const unknownAttribute = (value: VDFDocumentSymbol, parent: string, context: PopfileTextDocumentDiagnosticsContext): DiagnosticCodeAction => ({
			range: value.key.range,
			severity: DiagnosticSeverity.Warning,
			code: "unknown-attribute",
			source: this.languageId,
			message: `Unknown attribute '${value.key.text}' in ${parent} definition.`,
			data: {
				fix: ({ params: _params, createDocumentWorkspaceEdit }) => {
					const conditional = context.conditional ??= context.content.documentSymbols.findRecursive((documentSymbol) => documentSymbol.conditional != undefined && !TextDocumentBase.conditionals.has(documentSymbol.conditional.toUpperCase()))?.documentSymbol.conditional
					if (!conditional) {
						return null
					}

					return {
						title: `Add ${conditional}`,
						edit: createDocumentWorkspaceEdit(TextEdit.insert((value.value != undefined ? value.range : value.key.range).end, ` ${conditional}`))
					}
				}
			}
		})

		const d = DiagnosticFactory<PopfileTextDocumentDiagnosticsContext, Dependencies, Globals>(
			this,
			KeyDistinct.Last,
			(key) => key.toLowerCase(),
			(name, value, path, diagnostics, context) => {
				if (context.dependencies.configuration.popfile.diagnostics.strict) {
					if (value.conditional == null || TextDocumentBase.conditionals.has(value.conditional.toUpperCase())) {
						diagnostics.push(unknownAttribute(value, name, context))
					}
				}
			}
		)

		const length = (max: number): RefineString<PopfileTextDocumentDiagnosticsContext> => {
			return (name, detail, documentSymbol, path, diagnostics, _context) => {
				const length = detail.text.length + "\0".length
				if (length > max) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-length",
						source: this.languageId,
						message: `Value exceeds maximum buffer size (max: ${max}, size: ${length}).`,
					})
				}
			}
		}

		const validateSpawner: Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext> = (name, value, path, diagnostics, context) => {
			switch (value.key.text.toLowerCase()) {
				case "Mob".toLowerCase():
					return validateMob("Mob", value, path, diagnostics, context)
				case "RandomChoice".toLowerCase():
					return validateRandomChoice("RandomChoice", value, path, diagnostics, context)
				case "SentryGun".toLowerCase():
					return validateSentryGun("SentryGun", value, path, diagnostics, context)
				case "Squad".toLowerCase():
					return validateSquad("Squad", value, path, diagnostics, context)
				case "Tank".toLowerCase():
					validateTank("Tank", value, path, diagnostics, context)
					break
				case "TFBot".toLowerCase():
					validateTFBot("TFBot", value, path, diagnostics, context)
					break
				default:
					diagnostics.push(unknownAttribute(value, name, context))
					break
			}
		}

		const validateMob = d.documentSymbols({
			"Count": d.string(d.integer()),
			[unknown]: validateSpawner
		})

		const validateRandomChoice = d.documentSymbols({
			[unknown]: validateSpawner
		})

		const validateSentryGun = d.documentSymbols({
			"Level": d.string(d.set(values.level))
		})

		const validateSquad = d.sequence(
			d.documentSymbols({
				"FormationSize": d.string(d.float()),
				"ShouldPreserveSquad": d.string(d.set(["0", "1"])),
				[unknown]: (name, value, path, diagnostics, context) => {
					validateSpawner("Squad", value, path, diagnostics, context)
				}
			}),
			// https://github.com/cooolbros/vscode-vdf/issues/33
			(name, value, path, diagnostics, _context) => {
				if (value.children?.length == 1 && value.children[0].key.text.toLowerCase() == "TFBot".toLowerCase()) {
					diagnostics.push({
						range: value.range,
						severity: DiagnosticSeverity.Warning,
						code: "useless-squad",
						source: this.languageId,
						message: "Squad with 1 TFBot is useless.",
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Replace Squad with TFBot",
									edit: createDocumentWorkspaceEdit(TextEdit.replace(value.range, this.getText(value.children![0]!.range)))
								}
							}
						}
					})
				}
			}
		)

		const validateOutput = d.documentSymbols({
			"Action": d.string(),
			"Delay": d.string(d.float()),
			// https://github.com/cooolbros/vscode-vdf/issues/29
			"Param": d.string(length(4096)),
			"Target": d.string(),
		})

		const validateTank = d.documentSymbols({
			"Health": d.string(d.integer()),
			"Name": d.string(),
			"OnBombDroppedOutput": validateOutput,
			"OnKilledOutput": validateOutput,
			"Skin": d.string(d.set(["0", "1"])),
			"Speed": d.string(d.float()),
			"StartingPathTrackNode": d.string(),
		})

		// #region TFBot

		const validateItemAttributes = (): Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext> => {
			const validateItemNameOwner: RefineReference<PopfileTextDocumentDiagnosticsContext> = (name, detail, documentSymbol, path, diagnostics, context) => {
				const result = collectTFBotItems(path, context.content.definitionReferences.definitions)!
				const canonicalClassName = result.canonicalClassName
				const items = result.items

				if (items.length == 0 || !items.some((item) => item.toLowerCase() == detail.text.toLowerCase())) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-item",
						source: "popfile",
						message: `TFBot ${canonicalClassName != undefined ? `${canonicalClassName} ` : ""}does not own item "${detail.text}".${items.length > 0 ? ` Expected ${[...items].map((item) => `"${item}"`).join(" | ")}.` : ""}`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								const position = path.at(-1)!.key.range.start
								const before = this.getText(new VDFRange(position.with({ character: 0 }), position))
								const newText = `Item		${quote(detail.text) ? `"${detail.text}"` : detail.text}\n${before}`

								return {
									title: `Add item "${detail.text}"`,
									edit: createDocumentWorkspaceEdit(TextEdit.insert(position, newText))
								}
							}
						}
					})
				}
			}

			return d.sequence(
				d.documentSymbols({
					"ItemName": d.string(d.reference(types.item, "itemsGame", validateItemNameOwner)),
					[unknown]: () => { },
				}),
				(name, value, path, diagnostics, _context) => {
					if (value.children) {
						const itemName = value.children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "ItemName".toLowerCase() && documentSymbol.value != undefined)?.value
						if (itemName == undefined) {
							diagnostics.push({
								range: value.key.range,
								severity: DiagnosticSeverity.Warning,
								code: "missing-itemname",
								source: "popfile",
								message: "ItemAttributes block must include Itemname (TFBotSpawner: need to specify ItemName in ItemAttributes.)",
							})
						}
					}
				}
			)
		}

		const dynamicAttributes: { [key: string]: Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext> | [Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext>, KeyDistinct] } = {
			"Attributes": [d.string(d.set(values.attributes)), KeyDistinct.None],
			"BehaviorModifiers": d.string(d.set(values.behaviormodifiers)),
			"CharacterAttributes": d.documentSymbols({ [unknown]: () => { } }),
			"Item": [d.string(d.reference(types.item, "itemsGame")), KeyDistinct.None],
			"ItemAttributes": [validateItemAttributes(), KeyDistinct.None],
			"MaxVisionRange": d.string(d.float()),
			"Skill": d.string(d.set(values.skill)),
			// https://github.com/cooolbros/vscode-vdf/pull/72
			// Tags are limited to 256 characters due to CFmtStr - @Brain-dawg
			"Tag": [d.string(length(256)), KeyDistinct.None],
			"WeaponRestrictions": d.string(d.set(values.weaponrestrictions))
		}

		const validateEventChangeAttributes = d.documentSymbols({
			"Default": d.documentSymbols(dynamicAttributes),
			[unknown]: d.sequence(
				this.schema.validateEventName(d),
				d.documentSymbols(dynamicAttributes),
				(name, value, path, diagnostics, _context) => d.distinct(KeyDistinct.First, value, path.at(-1)!.children!, diagnostics)
			)
		})

		const validateWhere = d.string((name, detail, documentSymbol, path, diagnostics, context) => {
			const bsp = context.dependencies.bsp
			if (bsp != null) {
				if (!bsp.teamSpawns.some((teamSpawn) => teamSpawn.toLowerCase() == detail.text.toLowerCase())) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-value",
						source: this.languageId,
						message: `'${detail.text}' is not a valid value for ${name}. Expected '${bsp.teamSpawns.join("' | '")}'.`,
					})
				}
			}
		})

		const validateTFBot = d.documentSymbols({
			"AutoJumpMax": d.string(d.float()),
			"AutoJumpMin": d.string(d.float()),
			"Class": d.string(d.set(values.class)),
			"ClassIcon": d.string(this.schema.validateClassIcon(d)),
			"EventChangeAttributes": validateEventChangeAttributes,
			"Health": d.string(d.integer()),
			"Name": d.string(),
			"Scale": d.string(d.float()),
			"TeleportWhere": [validateWhere, KeyDistinct.None],
			"Template": [d.string(d.reference(types.template, null, this.schema.validateTemplateReference(d))), KeyDistinct.First],
			...dynamicAttributes,
		})

		// #endregion

		const validatePopulator = (): Validate<VDFDocumentSymbol, PopfileTextDocumentDiagnosticsContext> => {
			const where = new Set([
				"ClosestPoint".toLowerCase(),
				"Where".toLowerCase()
			])

			const spawners = new Set([
				"Mob".toLowerCase(),
				"RandomChoice".toLowerCase(),
				"SentryGun".toLowerCase(),
				"Squad".toLowerCase(),
				"Tank".toLowerCase(),
				"TFBot".toLowerCase(),
			])

			return (name, value, path, diagnostics, context) => {
				const key = value.key.text.toLowerCase()
				if (where.has(key)) {
					validateWhere("Where", value, path, diagnostics, context)
				}
				else if (spawners.has(key)) {
					// Not supporting conditionals here
					const spawner = path.at(-1)?.children!.findLast((documentSymbol) => spawners.has(documentSymbol.key.text.toLowerCase()))
					if (spawner == undefined) {
						throw new Error("unreachable")
					}

					if (spawner == value) {
						validateSpawner("" /* not used when spawners.has(key) */, value, path, diagnostics, context)
					}
					else {
						// Don't validate unreachable spawner because it is annoying
						diagnostics.push(d.unreachable(value.range))
					}
				}
				else {
					d.unknown(name, value, path, diagnostics, context)
				}
			}
		}

		const validateMission = d.documentSymbols({
			"BeginAtWave": d.string(d.integer()),
			"CooldownTime": d.string(d.float()),
			"DesiredCount": d.string(d.integer()),
			"InitialCooldown": d.string(d.float()),
			"Objective": d.string(d.set(values.objective)),
			"RunForThisManyWaves": d.string(d.integer()),
			[unknown]: validatePopulator(),
		})

		const validateTemplates = d.record(validateTFBot, KeyDistinct.First)

		// #region WaveSpawn

		const validateWaitBetweenSpawns = d.sequence(
			d.string(d.float()),
			(name, value, path, diagnostics, _context) => {
				const children = path.at(-1)!.children!

				// Not supporting conditionals here
				const waitBetweenSpawnsAfterDeath = children.findIndex((i) => i.key.text.toLowerCase() == "WaitBetweenSpawnsAfterDeath".toLowerCase())
				if (waitBetweenSpawnsAfterDeath != -1 && waitBetweenSpawnsAfterDeath < children.indexOf(value)) {
					diagnostics.push({
						range: value.key.range,
						severity: DiagnosticSeverity.Warning,
						code: "duplicate-wait",
						source: "popfile",
						message: "Already specified WaitBetweenSpawnsAfterDeath time, WaitBetweenSpawns won't be used.",
					})
				}
			}
		)

		const validateWaitBetweenSpawnsAfterDeath = d.sequence(
			d.string(d.float()),
			(name, value, path, diagnostics, _context) => {
				const children = path.at(-1)!.children!

				// Not supporting conditionals here
				const waitBetweenSpawns = children.findIndex((i) => i.key.text.toLowerCase() == "WaitBetweenSpawns".toLowerCase())
				if (waitBetweenSpawns != -1 && waitBetweenSpawns < children.indexOf(value)) {
					diagnostics.push({
						range: value.key.range,
						severity: DiagnosticSeverity.Warning,
						code: "duplicate-wait",
						source: "popfile",
						message: "Already specified WaitBetweenSpawns time, WaitBetweenSpawnsAfterDeath won't be used.",
					})
				}
			}
		)

		const validateWaitForAll = d.string(d.reference(types.wavespawn, null, (name, detail, documentSymbol, path, diagnostics, context, definitions) => {
			for (const definition of definitions) {
				const support: string | undefined = definition.data.support
				if (support != undefined && support != "Limited".toLowerCase()) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "wavespawn-softlock",
						source: "popfile",
						message: `${name} '${detail.text}' will cause softlock because ${definition.key} has Support '${support}'`,
					})
				}
			}
		}))

		const sound = d.file("sound", "sound", undefined)

		const validateSound = d.string(
			(name, detail, documentSymbol, path, diagnostics, context) => {
				const { chars, value } = removeSoundChars(detail.text)
				const definition = context.globals.gameSounds.get(null, types.gamesound, value)
				if (definition != null && definition.length) {
					d.canonical(definition[0].key, { text: value, range: detail.range, tokenRange: detail.tokenRange, quoted: detail.quoted }, diagnostics, { newText: (name) => `${chars}${name}` })
				}
				else {
					sound.validate(name, detail, documentSymbol, path, diagnostics, context)
				}
			}
		)

		const validateWaveSpawn = d.sequence(
			d.documentSymbols({
				"DoneOutput": validateOutput,
				"DoneWarningSound": validateSound,
				"FirstSpawnOutput": validateOutput,
				"FirstSpawnWarningSound": validateSound,
				"LastSpawnOutput": validateOutput,
				"LastSpawnWarningSound": validateSound,
				"MaxActive": d.string(d.integer()),
				"Name": d.string(),
				"RandomSpawn": d.string(d.set(values.randomspawn)),
				"SpawnCount": d.string(d.integer()),
				"StartWaveOutput": validateOutput,
				"Support": d.string(d.set(values.support)),
				"TotalCount": d.string(d.integer()),
				"TotalCurrency": d.string(d.integer()),
				"WaitBeforeStarting": d.string(d.float()),
				"WaitBetweenSpawns": validateWaitBetweenSpawns,
				"WaitBetweenSpawnsAfterDeath": validateWaitBetweenSpawnsAfterDeath,
				"WaitForAllDead": validateWaitForAll,
				"WaitForAllSpawned": validateWaitForAll,
				[unknown]: validatePopulator(),
			}),
			// https://github.com/cooolbros/vscode-vdf/issues/34
			(name, value, path, diagnostics, _context) => {
				if (value.children) {
					const maxActive = parseInt(value.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "MaxActive".toLowerCase())?.value?.text ?? "")
					const spawnCount = parseInt(value.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "SpawnCount".toLowerCase())?.value?.text ?? "")
					if (!isNaN(maxActive) && !isNaN(spawnCount) && spawnCount > maxActive) {
						diagnostics.push({
							range: value.key.range,
							severity: DiagnosticSeverity.Warning,
							code: "wavespawn-softlock",
							source: "popfile",
							message: `WaveSpawn with MaxActive ${maxActive} and SpawnCount ${spawnCount} will cause softlock`,
						})
					}
				}
			}
		)

		// #endregion

		const validateWave = d.documentSymbols({
			"Checkpoint": d.string(d.set(values.checkpoint)),
			"Description": d.string(),
			"DoneOutput": validateOutput,
			"InitWaveOutput": validateOutput,
			"Sound": validateSound,
			"StartWaveOutput": validateOutput,
			"WaitWhenDone": d.string(d.float()),
			"WaveSpawn": [validateWaveSpawn, KeyDistinct.None],
		})

		const getDiagnostics = d.header(
			d.documentSymbols({
				"AddSentryBusterWhenDamageDealtExceeds": d.string(d.integer()),
				"AddSentryBusterWhenKillCountExceeds": d.string(d.integer()),
				"Advanced": d.string(d.set(["1"])),
				// Accepts `no` and `false`, use `no` for canonical value
				"CanBotsAttackWhileInSpawnRoom": d.string(d.set(values.canbotsattackwhileinspawnroom)),
				"EventPopfile": d.string(d.set(["Halloween"])),
				"FixedRespawnWaveTime": d.string(d.set(["Yes"])),
				"IsEndless": d.string(d.set(["1"])),
				"Mission": [validateMission, KeyDistinct.None],
				"PeriodicSpawn": d.any(),
				"RandomPlacement": d.any(),
				"RespawnWaveTime": d.string(d.integer()),
				"StartingCurrency": d.string(d.integer()),
				"Templates": [validateTemplates, this.schema.TemplatesDistinct],
				"Wave": [validateWave, KeyDistinct.None],
			})
		)

		this.getDiagnostics = ({ diagnostics, ...params }) => {
			const context: PopfileTextDocumentDiagnosticsContext = {
				...params,
				classIcons: new Map(),
				sound: new Map()
			}

			this.base.getDiagnostics(diagnostics, context)
			getDiagnostics(diagnostics, context)

			for (const [classIcon, values] of context.classIcons) {
				context.subscriptions.push(
					this.classIcons.getOrInsertComputed(
						classIcon,
						() => this.fileSystem.resolve(`materials/hud/leaderboard_class_${classIcon}.vmt`).pipe(
							switchMap((entry) => {
								if (entry.type != EntryType.File) {
									return of(null)
								}

								return usingAsync(async () => await this.documents.get(entry.uri)).pipe(
									switchMap((document) => {
										if (document.languageId != "vmt") {
											throw new Error(document.languageId)
										}

										return document.baseTexture$.pipe(
											switchMap((path) => {
												if (path == null) {
													return of(null)
												}

												return this.fileSystem.resolve(path).pipe(
													switchMap((entry) => {
														if (entry.type != EntryType.File) {
															return of(null)
														}

														return fromTRPCSubscription(this.trpc.popfile.classIcon.flags, { uri: entry.uri }).pipe(
															map((flags) => ({ uri: entry.uri, flags }))
														)
													})
												)
											})
										)
									})
								)
							}),
							finalize(() => this.classIcons.delete(classIcon)),
							share({ connector: () => new ReplaySubject(1), resetOnRefCountZero: () => context.dispose$ })
						)
					).subscribe((vtf) => {
						if (!vtf) {
							for (const { index, range } of values) {
								diagnostics[index] = {
									range: range,
									severity: DiagnosticSeverity.Warning,
									code: "missing-file",
									source: "popfile",
									message: `Cannot find class icon '${classIcon}'. (materials/hud/leaderboard_class_${classIcon}.vmt)`,
								}
							}
						}
						else {
							// https://github.com/cooolbros/vscode-vdf/issues/62
							const noMip = (vtf.flags & 256) == 256
							const noLod = (vtf.flags & 512) == 512

							const message = `flag${!noMip && !noLod ? "s" : ""} ${!noMip ? `"No Mipmap"` : ""}${!noMip && !noLod ? " and " : ""}${!noLod ? `"No Level Of Detail"` : ""}`

							if (!noMip || !noLod) {
								for (const { index, range } of values) {
									diagnostics[index] = {
										range: range,
										severity: DiagnosticSeverity.Warning,
										code: "missing-vtf-flags",
										source: "popfile",
										message: `ClassIcon '${classIcon}' does not set VTF ${message}.`,
										data: {
											fix: () => {
												return {
													title: `Set VTF ${message}.`,
													command: {
														title: "",
														command: "vscode-vdf.setVTFFlags",
														arguments: [vtf.uri, 256 | 512]
													}
												}
											}
										}
									}
								}
							}
							else {
								for (const { index } of values) {
									diagnostics[index] = null
								}
							}
						}

						context.next()
					})
				)
			}

			sound.connect(diagnostics, context)
		}

		this.decorations$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base" && documentSymbol)?.children
				if (!waveSchedule) {
					return []
				}

				return waveSchedule.reduce(
					(decorations, documentSymbol) => {
						if (documentSymbol.key.text.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined) {
							const currency = documentSymbol.children.reduce(
								(currency, documentSymbol) => {
									if (documentSymbol.key.text.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
										const totalCurrency = parseInt(documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.text.toLowerCase() == "TotalCurrency".toLowerCase())?.value?.text ?? "")
										if (!isNaN(totalCurrency)) {
											currency += totalCurrency
										}
									}
									return currency
								},
								0
							)

							decorations.push({
								range: documentSymbol.key.tokenRange,
								renderOptions: {
									after: {
										contentText: `${decorations.length + 1} $${currency}`
									}
								}
							})
						}
						return decorations
					},
					<Decoration[]>[]
				)
			})
		)

		this.connect()
	}

	protected connect(): void {
		super.connect()
		this.stack.adopt(this.virtualDocumentRanges$.connect(), (connection) => connection.unsubscribe())
		this.stack.adopt(this.virtualTextDocumentContent$.connect(), (connection) => connection.unsubscribe())
		this.stack.adopt(
			this.virtualTextDocumentContent$.subscribe((text) => {
				PopfileTextDocument.virtualTextDocumentContents.set(this.virtualUri.toString(), { uri: this.uri, text: text })
			}),
			(subscription) => subscription.unsubscribe()
		)
	}

	public async onDidOpenTextDocument(server: VDFLanguageServer, connection: Connection): Promise<AsyncDisposable> {
		if (PopfileTextDocument.open == false) {
			PopfileTextDocument.open = true

			const registration = BulkRegistration.create()

			registration.add(SignatureHelpRequest.type, {
				documentSelector: [{ language: this.languageId }],
				// Squirrel
				triggerCharacters: ["(", ","]
			})

			registration.add(FoldingRangeRequest.type, {
				documentSelector: [{ language: this.languageId }],
			})

			registration.add(TextDocumentContentRequest.type, {
				schemes: ["embedded-squirrel"]
			})

			await connection.client.register(registration)

			connection.workspace.textDocumentContent.on((params) => {
				// Returning { text: undefined } causes "Unable to resolve text model content for resource embedded-squirrel:/... Code: -32603"
				const content = PopfileTextDocument.virtualTextDocumentContents.get(params.uri)
				return content != undefined ? { text: content.text } : null
			})

			connection.onSignatureHelp(async (params) => {
				await using document = await this.documents.get(new Uri(params.textDocument.uri))
				if (document.languageId != "popfile") {
					throw new Error(document.languageId)
				}

				return await document.onSignatureHelp(params)
			})

			connection.onFoldingRanges(async (params) => {
				await using document = await this.documents.get(new Uri(params.textDocument.uri))
				if (document.languageId != "popfile") {
					throw new Error(document.languageId)
				}

				return await document.onFoldingRanges(params)
			})

			const documentSymbols = await firstValueFrom(this.documentSymbols$)
			if (documentSymbols.findRecursive((documentSymbol) => documentSymbol.key.text.toLowerCase() == "Action".toLowerCase() && (documentSymbol.value?.text.toLowerCase() == "RunScriptCode".toLowerCase() || documentSymbol.value?.text.toLowerCase() == "RunScriptFile".toLowerCase()))) {
				void this.trpc.popfile.vscript.install.query({ name: this.uri.basename() })
			}
		}

		const subscription = this.virtualDocumentRanges$.subscribe(() => {
			void connection.workspace.textDocumentContent.refresh(this.virtualUri.toString())
		})

		return {
			[Symbol.asyncDispose]: async () => {
				subscription.unsubscribe()
			}
		}
	}

	public async onHover(params: HoverParams): Promise<Hover | undefined> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			const result = await this.trpc.popfile.embedded.commands.executeHoverProvider.query({ uri: this.virtualUri, position: params.position })
			if (result != undefined && result.length && result[0].contents.length) {
				return {
					contents: result[0].contents[0],
					range: result[0].range
				}
			}
			return
		}

		return await super.onHover(params)
	}

	public async onDefinition(params: DefinitionParams): Promise<Location[] | DefinitionLink[] | undefined> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			const result = await this.trpc.popfile.embedded.commands.executeDefinitionProvider.query({ uri: this.virtualUri, position: params.position })
			return result?.map(({ uri, range }) => ({ uri: (Uri.equals(uri, this.virtualUri) ? this.uri : uri).toString(), range: range }))
		}

		return await super.onDefinition(params)
	}

	public async onReferences(params: ReferenceParams): Promise<Location[] | undefined> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			const result = await this.trpc.popfile.embedded.commands.executeReferenceProvider.query({ uri: this.virtualUri, position: params.position })
			return result?.map(({ uri, range }) => ({ uri: (Uri.equals(uri, this.virtualUri) ? this.uri : uri).toString(), range: range }))
		}

		return await super.onReferences(params)
	}

	public async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
		const { documentSymbols, codeLens: rest } = await firstValueFrom(combineLatest({
			documentSymbols: this.documentSymbols$,
			codeLens: super.onCodeLens(params),
		}))

		const codeLens = []

		if (this.uri.basename().startsWith("mvm_")) {
			const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")
			if (waveSchedule?.children) {
				codeLens.push({
					range: waveSchedule.key.range,
					command: {
						title: "$(output-view-icon) Wave Status Preview",
						command: "vscode-vdf.showWaveStatusPreviewToSide"
					}
				})
			}
		}

		codeLens.push(...rest)
		return codeLens
	}

	public async onDocumentFormatting(params: DocumentFormattingParams): Promise<string> {
		const documentFormattingConfiguration = (await firstValueFrom(this.documentConfiguration$)).popfile.format

		const options: VDFFormatStringifyOptions = {
			indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
			insertNewlineBeforeObjects: documentFormattingConfiguration.insertNewlineBeforeObjects,
			quotes: documentFormattingConfiguration.quotes,
			tabSize: params.options.tabSize,
			tabs: documentFormattingConfiguration.tabs,
			newLine: VDFNewLine.LF,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		return formatVDF(this.getText(), PopfileTextDocument.VDFParserOptions, options)
	}

	public async getDocumentLinks(): Promise<DocumentLinkResolve[]> {
		const { documentSymbols, dependencies, embedded = [] } = await firstValueFrom(combineLatest({
			documentSymbols: this.documentSymbols$,
			dependencies: this.data$.pipe(map((data) => data.dependencies)),
			embedded: this.trpc.popfile.embedded.commands.executeLinkProvider.query({ uri: this.virtualUri })
		}))

		const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()

		return [
			...this.base.getDocumentLinks(documentSymbols),
			...embedded
				.values()
				.map((documentLink): DocumentLinkResolve => {
					return {
						range: documentLink.range,
						tooltip: documentLink.tooltip,
						data: {
							resolve: async () => documentLink.target ?? null
						}
					}
				}),
			...header.reduceRecursive(
				<DocumentLinkResolve[]>[],
				(documentLinks, documentSymbol) => {
					const key = documentSymbol.key.text.toLowerCase()

					if (key == "ClassIcon".toLowerCase() && documentSymbol.value?.text.trim().length) {
						documentLinks.push({
							range: documentSymbol.value.range,
							data: {
								resolve: async () => (await firstValueFrom(this.fileSystem.resolve(`materials/hud/leaderboard_class_${documentSymbol.value!.text}.vmt`))).uri
							}
						})
						return documentLinks
					}

					if (sounds.has(key) && documentSymbol.value?.text.trim().length) {
						const { value: sound } = removeSoundChars(documentSymbol.value.text)
						const definitions = dependencies.gameSounds.get(null, types.gamesound, sound)
						if (!definitions || !definitions.length) {
							documentLinks.push({
								range: documentSymbol.value.range,
								data: {
									resolve: async () => (await firstValueFrom(this.fileSystem.resolve(resolvePath(`sound/${sound}`)))).uri
								}
							})
						}
						return documentLinks
					}

					return documentLinks
				}
			)
		]
	}

	public async getDocumentColor(): Promise<ColourInformationStringify[]> {
		const documentSymbols = await firstValueFrom(this.documentSymbols$)
		const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()

		return header.reduceRecursive(
			<ColourInformationStringify[]>[],
			(documentColours, documentSymbol) => {
				if (documentSymbol.children) {
					return documentColours
				}

				const key = documentSymbol.key.text.toLowerCase()
				if ((key == set_item_tint_rgb || key == set_item_tint_rgb_2) && documentSymbol.value != undefined && /^\d+$/.test(documentSymbol.value.text)) {
					const colour = parseInt(documentSymbol.value.text)

					const red = ((colour >> 16) & 255) / 255
					const green = ((colour >> 8) & 255) / 255
					const blue = ((colour >> 0) & 255) / 255
					const alpha = 255

					documentColours.push({
						range: documentSymbol.value.range,
						color: { red, green, blue, alpha },
						stringify: (colour) => (colour.red * 255 << 16 | colour.green * 255 << 8 | colour.blue * 255 << 0).toString(),
					})
				}

				return documentColours
			}
		)
	}

	public async onInlayHint(params: { range: VDFRange }): Promise<InlayHint[]> {
		const { inlayHints = [], documentSymbols, paints, effects } = await firstValueFrom(combineLatest({
			inlayHints: this.trpc.popfile.embedded.commands.executeInlayHintProvider.query({ uri: this.virtualUri, range: params.range }),
			documentSymbols: this.documentSymbols$,
			paints: this.workspace.paints$,
			effects: this.workspace.effects$,
		}))

		return documentSymbols.reduceRecursive(
			inlayHints,
			(inlayHints, documentSymbol) => {
				if (documentSymbol.value == undefined) {
					return inlayHints
				}

				const key = documentSymbol.key.text.toLowerCase()

				if ((key == set_item_tint_rgb || key == set_item_tint_rgb_2) && paints.has(documentSymbol.value.text)) {
					inlayHints.push({
						position: documentSymbol.value.range.end,
						label: paints.get(documentSymbol.value.text)!,
						kind: InlayHintKind.Type,
						paddingLeft: true
					})

					return inlayHints
				}

				if ((key == attach_particle_effect || key == attach_particle_effect_static) && effects.has(documentSymbol.value.text)) {
					inlayHints.push({
						position: documentSymbol.value.range.end,
						label: effects.get(documentSymbol.value.text)!,
						kind: InlayHintKind.Type,
						paddingLeft: true
					})
				}

				return inlayHints
			}
		)
	}

	private async onSignatureHelp(params: SignatureHelpParams): Promise<SignatureHelp | undefined> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			return await this.trpc.popfile.embedded.commands.executeSignatureHelpProvider.query({ uri: this.virtualUri, position: params.position, triggerCharacter: params.context?.triggerCharacter })
		}
	}

	private async onFoldingRanges(_params: FoldingRangeParams): Promise<FoldingRange[] | undefined> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		return ranges.map((range) => FoldingRange.create(range.start.line, range.end.line, range.start.character, range.end.character, FoldingRangeKind.Region))
	}

	public async onPrepareRename(params: PrepareRenameParams): Promise<PrepareRenamePlaceholder | null> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			throw new Error(`Cannot execute rename inside VScript block https://github.com/microsoft/vscode/issues/342761`)
		}

		const placeholder = await super.onPrepareRename(params)
		if (this.rename!.type == types.gamesound) {
			// game sound references are not loaded so they cannot be renamed
			throw new Error(`Cannot rename ${types.gamesound.name} '${this.rename!.key}'`)
		}

		return placeholder
	}

	public async onRenameRequest(params: RenameParams): Promise<WorkspaceEdit | null> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			return null
			// const workspaceEdit = await this.trpc.popfile.embedded.commands.executeDocumentRenameProvider.query({
			// 	uri: this.virtualUri,
			// 	position: params.position,
			// 	newName: params.newName,
			// })

			// if (!workspaceEdit) {
			// 	return null
			// }

			// const changes: Record<string, TextEdit[]> = {}
			// for (const uri in workspaceEdit.changes) {
			// 	const edits = workspaceEdit.changes[uri]
			// 	const virtual = PopfileTextDocument.virtualTextDocumentContents.get(uri)
			// 	if (virtual != undefined) {
			// 		changes[virtual.uri.toString()] = edits
			// 	}
			// 	else {
			// 		changes[uri] = edits
			// 	}
			// }
			//
			// return { changes }
		}

		return await super.onRenameRequest(params)
	}

	public async onCompletion(params: CompletionParams): Promise<CompletionList | null> {
		const ranges = await firstValueFrom(this.virtualDocumentRanges$)
		if (ranges.some((range) => range.contains(params.position))) {
			const completionList = await this.trpc.popfile.embedded.commands.executeCompletionItemProvider.query({
				uri: this.virtualUri,
				position: params.position,
				triggerCharacter: params.context?.triggerCharacter,
			})

			if (!completionList) {
				return null
			}

			return {
				isIncomplete: completionList.isIncomplete,
				itemDefaults: {
					data: {
						uri: this.uri,
						embedded: true,
					}
				},
				items: completionList.items
			}
		}

		return await super.onCompletion(params)
	}

	public async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
		if (item.data?.embedded) {
			return item
		}

		return await super.onCompletionResolve(item)
	}

	protected async getCompletion(params: VDFCompletionParams): Promise<VDFCompletionList | null> {
		return await VDFTextDocument.getCompletion(
			this,
			params,
			async (params, path, token) => {
				const data = await firstValueFrom(this.data$)
				const events = data.dependencies.bsp?.events ?? PopfileTextDocument.events

				if (!path.length) {
					return {
						before: this.base.completionBaseKeys(params, token),
						cls: {
							one: ["WaveSchedule"]
						}
					}
				}

				const key = path.at(-1)!.key.text.toLowerCase()

				// CharacterAttributes
				if (key == "CharacterAttributes".toLowerCase()) {
					return {
						field: {
							kind: CompletionItemKind.Property,
							one: (await firstValueFrom(data.globals.get("itemsGame").definitions$))
								.ofType(null, types.attribute)
								.values()
								.map((definition) => definition[0].key)
								.toArray()
						}
					}
				}

				// ItemAttributes
				if (key == "ItemAttributes".toLowerCase()) {
					return {
						before: [
							{
								label: "ItemName",
								textEditText: "ItemName\t\"$0\"",
								insertTextFormat: InsertTextFormat.Snippet,
								command: {
									title: "Trigger Suggest",
									command: "editor.action.triggerSuggest"
								}
							}
						],
						field: {
							one: (await firstValueFrom(data.globals.get("itemsGame").definitions$))
								.ofType(null, types.attribute)
								.values()
								.map((definition) => definition[0].key)
								.toArray()
						}
					}
				}

				// EventChangeAttributes
				if (key == "EventChangeAttributes".toLowerCase()) {
					return {
						cls: {
							one: events.values().toArray()
						}
					}
				}

				// Dynamic Events
				if (events.has(key)) {
					return {
						field: {
							one: ["MaxVisionRange", "Skill", "WeaponRestrictions"],
							many: ["Attributes", "BehaviorModifiers", "Item"],
							values: values
						},
						cls: {
							one: ["CharacterAttributes"],
						},
						after: <VDFCompletionItem[]>keys.tfbot.value.after
					}
				}

				const type = path
					.reverse()
					.values()
					.map((documentSymbol) => documentSymbol.key.text.toLowerCase())
					.find((type) => ((type): type is keyof typeof keys => type in keys)(type))
					?? null

				if (!type) {
					return null
				}

				const include = (k: keyof typeof keys): Extract<(typeof keys)[keyof typeof keys], { value: unknown }>["value"] | null => {
					const value = keys[k]
					if ("reference" in value) {
						return include(<keyof typeof keys>value.reference)
					}
					else if ("value" in value) {
						return value.value
					}
					else {
						return null
					}
				}

				const included = include(type)
				if (!included) {
					return null
				}

				return {
					field: {
						one: included.field.one,
						many: "many" in included.field ? included.field.many : undefined,
						values: values,
					},
					cls: "cls" in included ? included.cls : undefined,
					after: "after" in included ? <VDFCompletionItem[]>included.after : undefined,
				}
			},
			async (params, path, key, token) => {
				key = key.toLowerCase()
				if (key == "#base") {
					return await this.base.completionBaseValues(params, token)
				}

				// Static
				if (((key): key is keyof typeof values => key in values)(key)) {
					const data = values[key]
					return {
						token: token,
						length: data.length,
						items: data.map((value) => ({
							label: value,
							kind: CompletionItemKind.EnumMember,
						}) satisfies VDFCompletionItem)
					}
				}

				// ItemName
				if (key == "ItemName".toLowerCase()) {
					const definitions = await firstValueFrom(this.definitions$)

					const result = collectTFBotItems(path, definitions)
					if (result == null) {
						return null
					}

					return {
						length: result.items.length,
						items: result.items.map((item) => ({
							label: item,
							kind: CompletionItemKind.Variable,
						}))
					}
				}

				// Definitions
				const definitionTypes = <const>[
					{ type: types.item, global: "itemsGame", keys: new Set(["Item".toLowerCase()]) },
					{ type: types.template, global: null, keys: new Set(["Template".toLowerCase()]) },
					{ type: types.wavespawn, global: null, keys: new Set(["WaitForAllSpawned".toLowerCase(), "WaitForAllDead".toLowerCase()]) },
				]

				const data = await firstValueFrom(this.data$)
				for (const { type, keys, global } of definitionTypes) {
					if (keys.has(key)) {
						const scope = data.content.definitionReferences.scopes.get(type)?.entries().find(([_scope, ranges]) => ranges.some((range) => range.contains(params.position)))?.[0] ?? null
						const definitions = (await firstValueFrom(global == null ? this.definitions$ : this.data$.pipe(switchMap((data) => data.globals.get(global).definitions$)))).ofType(scope, type)
						return {
							length: definitions.size,
							items: definitions
								.values()
								.map((definition) => definition[0].completionItem)
						}
					}
				}

				// ClassIcon
				if (key == "ClassIcon".toLowerCase()) {
					const completionList = await params.files({
						folder: "materials/hud",
						params: params,
						token: token,
						basenamePattern: "leaderboard_class_*.vmt",
						filter: ([name, type], startsWithFilter) => type == 1 && startsWithFilter(name.substring("leaderboard_class_".length)),
						map: (name) => posix.parse(name.substring("leaderboard_class_".length)).name,
						image: true
					})

					return {
						token: completionList.token,
						length: completionList.length,
						items: Iterator
							.from(completionList.items)
							.map((item) => {
								item.label = item.label.substring("leaderboard_class_".length)
								return item
							})
					}
				}

				// Where
				if (key == "Where".toLowerCase() || key == "ClosestPoint".toLowerCase()) {
					const data = await firstValueFrom(this.data$)
					if (data.dependencies.bsp == null) {
						return null
					}

					return {
						length: data.dependencies.bsp.teamSpawns.length,
						items: data.dependencies.bsp.teamSpawns
							.values()
							.map((teamSpawn) => ({
								label: teamSpawn,
								kind: CompletionItemKind.EnumMember,
							}))
					}
				}

				// Target
				if (key == "Target".toLowerCase()) {
					const data = await firstValueFrom(this.data$)
					if (data.dependencies.bsp == null) {
						return null
					}

					return {
						length: data.dependencies.bsp.targets.length,
						items: data.dependencies.bsp.targets
							.values()
							.map((target) => ({
								label: target,
								kind: CompletionItemKind.EnumMember,
							}))
					}
				}

				// StartingPathTrackNode
				if (key == "StartingPathTrackNode".toLowerCase()) {
					const data = await firstValueFrom(this.data$)
					if (data.dependencies.bsp == null) {
						return null
					}

					return {
						length: data.dependencies.bsp.pathTracks.length,
						items: data.dependencies.bsp.pathTracks
							.values()
							.map((pathTrack) => ({
								label: pathTrack,
								kind: CompletionItemKind.EnumMember,
							}))
					}
				}

				// Sounds
				if (sounds.has(key)) {
					const [soundFiles, gameSounds] = await Promise.all([
						params.files({ folder: "sound", params: params, token: token }),
						firstValueFrom(this.workspace.gameSounds$).then((gameSounds) => {
							const definitions = gameSounds.ofType(null, types.gamesound)

							return {
								length: definitions.size,
								items: definitions
									.values()
									.map((value) => value[0].completionItem)
							}
						})
					])

					return {
						length: soundFiles.length + gameSounds.length,
						items: (function*() {
							yield* Iterator.from(soundFiles.items)
							yield* gameSounds.items
						})()
					}
				}

				// Paints
				if (key == set_item_tint_rgb || key == set_item_tint_rgb_2) {
					const paints = await firstValueFrom(this.workspace.paints$)
					return {
						token: new VDFRange(params.position),
						length: paints.size,
						items: paints
							.entries()
							.map(([key, name]) => {
								const colour = parseInt(key)
								const r = (colour >> 16) & 255
								const g = (colour >> 8) & 255
								const b = (colour >> 0) & 255

								return {
									label: name,
									labelDetails: { description: key },
									kind: CompletionItemKind.Color,
									documentation: { kind: MarkupKind.Markdown, value: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}` },
									filterText: name,
									textEditText: key,
								} satisfies CompletionItem
							})
					}
				}

				// Effects
				if (key == attach_particle_effect || key == attach_particle_effect_static) {
					const effects = await firstValueFrom(this.workspace.effects$)
					return {
						token: new VDFRange(params.position),
						length: effects.size,
						items: effects
							.entries()
							.map(([key, name]) => {
								return {
									label: name,
									labelDetails: {
										description: key
									},
									kind: CompletionItemKind.Event, /* CompletionItemKind.Event looks like an effect */
									filterText: name,
									textEditText: key,
								} satisfies CompletionItem
							})
					}
				}

				return null
			}
		)
	}
}
