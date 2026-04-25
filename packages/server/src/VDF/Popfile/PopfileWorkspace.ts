import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { findMap } from "common/popfile/findMap"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { finalize, firstValueFrom, map, Observable, of, ReplaySubject, share, Subject, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CompletionItem, CompletionItemKind } from "vscode-languageserver"
import { z } from "zod"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "../../DefinitionReferences"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VDFTextDocumentSchema } from "../VDFTextDocument"
import type { PopfileLanguageServer } from "./PopfileLanguageServer"
import type { PopfileTextDocument, PopfileTextDocumentDependencies } from "./PopfileTextDocument"

export class PopfileWorkspace extends WorkspaceBase {

	public readonly game_sounds: Promise<DefinitionReferences>
	public readonly paints: Promise<Map<string, string>>
	public readonly effects: Promise<Map<string, string>>
	public readonly dependencies: Promise<{
		schema: {
			keys: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["keys"],
			values: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["values"],
		},
		completion: Pick<VDFTextDocumentSchema<PopfileTextDocumentDependencies>["completion"], "values">,
		globals$: Observable<DefinitionReferences[]>
	}>

	private readonly maps: Map<
		string,
		Promise<{
			bsp: `mvm_${string}.bsp`,
			events: Map<string, string>,
			schema: {
				keys: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["keys"],
				values: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["values"],
				completion: { values: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["completion"]["values"] }
			}
		} | null>
	>
	private readonly classIcons: Map<string, Observable<{ uri: Uri, flags: number } | null>>
	public readonly disposeClassIcons$: Subject<void>

	constructor(
		public readonly fileSystem: FileSystemMountPoint,
		private readonly server: PopfileLanguageServer,
		documents: RefCountAsyncDisposableFactory<Uri, PopfileTextDocument>,
	) {
		super(new Uri({ scheme: "file", path: "/" }))

		const items_game = Promise.try(async () => {
			const uri = await firstValueFrom(this.fileSystem.resolveFile("scripts/items/items_game.txt"))
			const document = await documents.get(uri!)
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const items_game = documentSymbols.find((documentSymbol) => documentSymbol.key == "items_game")?.children
			if (!items_game) {
				throw new Error("items_game")
			}

			return { document: document, documentSymbols: items_game }
		})

		const tf_english = Promise.try(async () => {
			const uri = await firstValueFrom(this.fileSystem.resolveFile("resource/tf_english.txt"))
			await using document = await documents.get(uri!)
			const documentSymbols = getVDFDocumentSymbols(document.text$.value, { multilineStrings: true })

			const lang = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "lang".toLowerCase())?.children
			if (!lang) {
				throw new Error("lang")
			}

			const tokens = lang.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Tokens".toLowerCase())?.children
			if (!tokens) {
				throw new Error("Tokens")
			}

			return new Map(
				tokens
					.filter((documentSymbol) => documentSymbol.detail != undefined)
					.map((documentSymbol) => [documentSymbol.key, documentSymbol.detail!])
			)
		})

		const items = Promise.all([items_game, tf_english]).then(([items_game, tf_english]) => {
			const items = items_game.documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "items")?.children
			if (!items) {
				throw new Error("items")
			}

			const collection = new Collection<Definition>()

			const definitions = items
				.values()
				.drop(1 /* "default" */)
				.map((documentSymbol) => {
					const name = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "name")!

					const item_name = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "item_name")?.detail?.substring("#".length)
					const itemName = item_name != undefined ? tf_english.get(item_name) : undefined

					const image_inventory = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "image_inventory")?.detail
					const data = image_inventory != undefined
						? { image: { uri: items_game.document.uri, path: posix.join("materials", `${image_inventory}.vmt`) } }
						: undefined

					return {
						uri: items_game.document.uri,
						key: name.detail!,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: undefined,
						detail: undefined,
						documentation: items_game.document.definitions.documentation(documentSymbol, "vdf"),
						conditional: documentSymbol.conditional ?? undefined,
						completionItem: {
							labelDetails: {
								description: itemName,
							},
							filterText: itemName,
							data: data
						}
					} satisfies Definition
				})
				.filter((item) => item != null)

			for (const definition of definitions) {
				collection.set(null, Symbol.for("item"), definition.key, definition)
			}

			return {
				scopes: new Map(),
				definitions: new Definitions({ version: [items_game.document.version], collection }),
				references: new References(items_game.document.uri, new Collection<VDFRange>(), [])
			} satisfies DefinitionReferences
		})

		const attributes = items_game.then(async (items_game) => {
			const attributes = items_game.documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "attributes")?.children
			if (!attributes) {
				throw new Error("attributes")
			}

			const completionItems = attributes
				.values()
				.map((documentSymbol) => documentSymbol.children?.find((documentSymbol) => documentSymbol.key == "name")?.detail)
				.filter((attribute) => attribute != undefined)
				.map((attribute) => ({ label: attribute, kind: CompletionItemKind.Constant }))
				.toArray()

			return {
				keys: {
					[`${"CharacterAttributes".toLowerCase()}`]: { values: completionItems },
					[`${"ItemAttributes".toLowerCase()}`]: {
						values: [
							{
								label: "ItemName",
								kind: CompletionItemKind.Field
							},
							...completionItems
						]
					}
				}
			}
		})

		this.game_sounds = Promise.try(async () => {
			const uri = await firstValueFrom(this.fileSystem.resolveFile("scripts/game_sounds_manifest.txt"))
			await using document = await documents.get(uri!)
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const game_sounds_manifest = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "game_sounds_manifest")?.children
			if (!game_sounds_manifest) {
				throw new Error("game_sounds_manifest")
			}

			const files = game_sounds_manifest
				.values()
				.map((documentSymbol) => documentSymbol.detail)
				.filter((detail) => detail != undefined)

			const collection = new Collection<Definition>()

			const results = await Promise.all(files.map(async (file) => {
				const uri = await firstValueFrom(this.fileSystem.resolveFile(file))
				if (!uri) {
					return []
				}

				await using document = await documents.get(uri)
				const documentSymbols = await firstValueFrom(document.documentSymbols$)

				return documentSymbols.map((documentSymbol) => {
					return {
						uri: uri,
						key: documentSymbol.key,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: undefined,
						detail: undefined,
						documentation: document.definitions.documentation(documentSymbol, "vdf"),
						conditional: documentSymbol.conditional ?? undefined,
					} satisfies Definition
				})
			}))

			for (const result of results) {
				for (const definition of result) {
					collection.set(null, Symbol.for("sound"), definition.key, definition)
				}
			}

			return {
				scopes: new Map(),
				definitions: new Definitions({ version: [document.version], collection }),
				references: new References(document.uri, new Collection<VDFRange>(), [])
			} satisfies DefinitionReferences
		})

		this.paints = Promise.all([items_game, tf_english]).then(([items_game, tf_english]) => {
			const items = items_game.documentSymbols.find((documentSymbol) => documentSymbol.key == "items")?.children
			if (!items) {
				throw new Error("items")
			}

			const paints: Record<string, string> = {}

			for (const documentSymbol of items) {
				const prefab = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "prefab")?.detail?.toLowerCase()
				if (prefab == "valve paint_can" || prefab == "valve paint_can_team_color") {
					const item_name = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "item_name")?.detail?.substring("#".length)
					const attributes = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "attributes")?.children
					if (!item_name || !attributes) {
						continue
					}

					switch (prefab) {
						case "valve paint_can":
							const rgb = attributes.find((documentSymbol) => documentSymbol.key.toLowerCase() == "set item tint RGB".toLowerCase())?.children
							if (rgb) {
								const value = rgb.find((documentSymbol) => documentSymbol.key.toLowerCase() == "value")?.detail
								if (value) {
									paints[value] = tf_english.get(item_name)!
								}
							}
							break
						case "valve paint_can_team_color": {
							const rgb = attributes.find((documentSymbol) => documentSymbol.key.toLowerCase() == "set item tint RGB".toLowerCase())?.children
							const rgb2 = attributes.find((documentSymbol) => documentSymbol.key.toLowerCase() == "set item tint RGB 2".toLowerCase())?.children
							if (rgb && rgb2) {
								const value = rgb.find((documentSymbol) => documentSymbol.key.toLowerCase() == "value")?.detail
								const value2 = rgb2.find((documentSymbol) => documentSymbol.key.toLowerCase() == "value")?.detail
								if (value && value2) {
									paints[value] = `${tf_english.get(item_name)!} (Red)`
									paints[value2] = `${tf_english.get(item_name)!} (Blu)`
								}
							}
							break
						}
						default:
							continue
					}
				}
			}

			return new Map(Object.entries(paints).sort((a, b) => a[0].localeCompare(b[0])))
		})

		this.effects = tf_english.then((tf_english) => {
			const attrib_particle = "Attrib_Particle".toLowerCase()
			return new Map(
				tf_english
					.entries()
					.filter(([key]) => key.toLowerCase().startsWith(attrib_particle))
					.map(([key, value]) => [key.substring(attrib_particle.length), value])
			)
		})

		this.dependencies = Promise.all([items, attributes, this.game_sounds, this.paints, this.effects]).then(([items, attributes, game_sounds, paints, effects]) => {
			const paintItems = paints
				.entries()
				.map(([key, name]) => {

					const colour = parseInt(key)
					const r = (colour >> 16) & 255
					const g = (colour >> 8) & 255
					const b = (colour >> 0) & 255
					return {
						label: name,
						labelDetails: {
							description: key
						},
						kind: CompletionItemKind.Color,
						documentation: `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
						filterText: name,
						insertText: key,
					} satisfies CompletionItem
				})
				.toArray()

			const effectsItems = effects
				.entries()
				.map(([key, name]) => {
					return {
						label: name,
						labelDetails: {
							description: key
						},
						kind: CompletionItemKind.Event,
						filterText: name,
						insertText: key,
					} satisfies CompletionItem
				})
				.toArray()

			return {
				schema: {
					keys: {
						...attributes.keys,
					},
					values: {}
				},
				completion: {
					values: {
						[`${"set item tint RGB".toLowerCase()}`]: paintItems,
						[`${"set item tint RGB 2".toLowerCase()}`]: paintItems,
						[`${"attach particle effect".toLowerCase()}`]: effectsItems,
						[`${"attach particle effect static".toLowerCase()}`]: effectsItems,
					}
				},
				globals$: of([items, game_sounds])
			}
		})

		this.maps = new Map()
		this.classIcons = new Map()
		this.disposeClassIcons$ = new Subject<void>()
	}

	public async entities(uri: Uri) {
		const basename = uri.basename()
		if (posix.extname(basename) != ".pop") {
			return null
		}

		const bsp = await findMap(uri, this.fileSystem)
		if (!bsp) {
			return null
		}

		if (!this.maps.has(bsp)) {
			this.maps.set(bsp, Promise.try(async () => {
				const uri = await firstValueFrom(this.fileSystem.resolveFile(`maps/${bsp}`))
				if (!uri) {
					return null
				}

				const entities = await this.server.trpc.client.popfile.bsp.entities.query({ uri }).then((entities) => entities && Map.groupBy(entities, (item) => item.classname))
				if (!entities) {
					return null
				}

				console.log(`${bsp}:`)
				console.log(JSON.stringify(Object.fromEntries(entities), null, 4))

				// Where
				const teamSpawns = [
					...new Set(
						entities
							?.get("info_player_teamspawn")
							?.toSorted((a, b) => (<string>b["TeamNum"])?.localeCompare(<string>a["TeamNum"]) || a.targetname?.localeCompare(b.targetname!) || 0)
							.values()
							.map((entity) => entity.targetname)
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
							.filter((entity) => !entities.get("path_track")!.some((e) => e["target"] == entity.targetname))
							.map((entity) => entity.targetname)
							.filter((targetname) => targetname != undefined)
					)
				].toSorted()

				// Target
				const targets = [
					...new Set(
						entities
							?.values()
							?.flatMap((value) => value)
							.map((entity) => entity.targetname)
							.filter((targetname) => targetname != undefined)
							.filter((targetname) => !targetname.startsWith("//"))
					),
					"BigNet"
				].toSorted()

				// EventChangeAttributes
				const OnTriggerSchema = z.array(z.string())
				const populator = entities.get("point_populator_interface")?.[0]?.targetname
				const events = new Map([["default", "Default"]])
				for (const logic_relay of entities.get("logic_relay") ?? []) {
					for (const trigger of OnTriggerSchema.safeParse(logic_relay["OnTrigger"]).data ?? []) {
						const [target, input, parameter, delay, once] = trigger.split(",")
						if (target != undefined && input != undefined && parameter != undefined && target == populator && (input.toLowerCase() == "ChangeBotAttributes" || input.toLowerCase() == "ChangeDefaultEventAttributes".toLowerCase())) {
							const key = parameter.toLowerCase()
							if (!events.has(key)) {
								events.set(parameter.toLowerCase(), parameter)
							}
						}
					}
				}

				return {
					bsp: bsp,
					events: events,
					schema: {
						keys: {
							[`${"EventChangeAttributes".toLowerCase()}`]: {
								values: events.values().map((event) => ({ label: event, kind: CompletionItemKind.Class })).toArray()
							},
							...Object.fromEntries(
								events.keys().map((key) => [key, {
									values: [
										{ label: "CharacterAttributes", kind: CompletionItemKind.Class },
										{ label: "ItemAttributes", kind: CompletionItemKind.Class, multiple: true },
										{ label: "Attributes", kind: CompletionItemKind.Field, multiple: true },
										{ label: "BehaviorModifiers", kind: CompletionItemKind.Field },
										{ label: "Item", kind: CompletionItemKind.Field, multiple: true },
										{ label: "MaxVisionRange", kind: CompletionItemKind.Field },
										{ label: "Skill", kind: CompletionItemKind.Field },
										{ label: "WeaponRestrictions", kind: CompletionItemKind.Field }
									]
								}])
							)
						},
						values: {
							[`${"ClosestPoint".toLowerCase()}`]: {
								kind: CompletionItemKind.Enum,
								values: teamSpawns
							},
							[`${"Where".toLowerCase()}`]: {
								kind: CompletionItemKind.Enum,
								values: teamSpawns
							}
						},
						completion: {
							values: {
								[`${"StartingPathTrackNode".toLowerCase()}`]: pathTracks.map((value) => ({ label: value, kind: CompletionItemKind.Enum })),
								[`${"Target".toLowerCase()}`]: targets.map((value) => ({ label: value, kind: CompletionItemKind.Enum })),
							}
						}
					}
				}
			}))
		}

		return await this.maps.get(bsp)!
	}

	public classIconFlags(icon: string): Observable<{ uri: Uri, flags: number } | null> {
		let classIcon$ = this.classIcons.get(icon)
		if (!classIcon$) {
			classIcon$ = this.fileSystem.resolveFile(`materials/hud/leaderboard_class_${icon}.vmt`).pipe(
				switchMap((uri) => {
					if (uri == null) {
						return of(null)
					}

					return fromTRPCSubscription(this.server.trpc.servers.vmt.baseTexture, { uri }).pipe(
						switchMap((uri) => {
							if (uri == null) {
								return of(null)
							}

							return fromTRPCSubscription(this.server.trpc.client.popfile.classIcon.flags, { uri }).pipe(
								map((flags) => ({ uri, flags }))
							)
						})
					)
				}),
				finalize(() => this.classIcons.delete(icon)),
				share({
					connector: () => new ReplaySubject(1),
					resetOnRefCountZero: () => this.disposeClassIcons$
				})
			)

			this.classIcons.set(icon, classIcon$)
		}

		return classIcon$
	}
}
