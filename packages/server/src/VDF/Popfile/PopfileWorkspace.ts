import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { findMap } from "common/popfile/findMap"
import { Uri } from "common/Uri"
import { combineLatest, concatMap, firstValueFrom, map, Observable, shareReplay, take } from "rxjs"
import { CompletionItemKind, type CompletionItem } from "vscode-languageserver"
import { z } from "zod"
import { References, type GlobalDefinitionReferences } from "../../DefinitionReferences"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VDFTextDocumentSchema } from "../VDFTextDocument"
import type { PopfileLanguageServer } from "./PopfileLanguageServer"
import type { PopfileTextDocumentDependencies } from "./PopfileTextDocument"

export class PopfileWorkspace extends WorkspaceBase {

	private readonly server: PopfileLanguageServer

	public readonly gameSounds$: Observable<GlobalDefinitionReferences>
	public readonly paints: Promise<Map<string, string>>
	public readonly effects: Promise<Map<string, string>>
	public readonly dependencies: Promise<{
		schema: {
			keys: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["keys"],
			values: VDFTextDocumentSchema<PopfileTextDocumentDependencies>["values"],
		},
		completion: Pick<VDFTextDocumentSchema<PopfileTextDocumentDependencies>["completion"], "values">,
		globals$: Observable<GlobalDefinitionReferences[]>
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

	constructor({
		teamFortress2Folder,
		fileSystem,
		server,
	}: {
		teamFortress2Folder: Uri,
		fileSystem: FileSystemMountPoint,
		server: PopfileLanguageServer,
	}) {
		super(teamFortress2Folder, fileSystem)
		this.server = server

		this.gameSounds$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.gameSounds, { key: teamFortress2Folder }).pipe(
			map((definitions) => {
				return {
					definitions: definitions,
					references: {
						setDocumentReferences: (references, notify) => {
							const map = new Map<string, Map<string, References | null>>()
							map.set("scripts/game_sounds_manifest.txt", references)

							server.trpc.servers.vgui.workspace.setFilesReferences.mutate({
								key: teamFortress2Folder,
								references: map
							})
						},
					}
				} satisfies GlobalDefinitionReferences
			}),
			take(1),
			shareReplay(1),
		)

		const languageTokens$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.languageTokens, { key: teamFortress2Folder }).pipe(
			take(1),
			shareReplay(1),
		)

		const itemsGame$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.itemsGame.open, { key: teamFortress2Folder }).pipe(
			shareReplay({ bufferSize: 1, refCount: true })
		)

		const items = firstValueFrom(
			itemsGame$.pipe(
				concatMap(async () => {
					return await server.trpc.servers.vgui.workspace.itemsGame.documentSymbol.query({ key: teamFortress2Folder, name: "items" })
				}),
			)
		)

		const itemsDefinitions = firstValueFrom(
			itemsGame$.pipe(
				concatMap(async () => {
					return await server.trpc.servers.vgui.workspace.itemsGame.definitions.query({ key: teamFortress2Folder })
				}),
				map((definitions) => {
					return {
						definitions: definitions,
						references: {
							setDocumentReferences: (references, notify) => {
								const map = new Map<string, Map<string, References | null>>()
								map.set("scripts/items/items_game.txt", references)

								server.trpc.servers.vgui.workspace.setFilesReferences.mutate({
									key: teamFortress2Folder,
									references: map
								})
							},
						}
					} satisfies GlobalDefinitionReferences
				}),
			)
		)

		const attributes = firstValueFrom(
			itemsGame$.pipe(
				concatMap(async () => {
					return await server.trpc.servers.vgui.workspace.itemsGame.documentSymbol.query({ key: teamFortress2Folder, name: "attributes" })
				}),
				map((documentSymbols) => {
					const completionItems = documentSymbols
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
				}),
			)
		)

		const paints$ = combineLatest({
			items: items,
			languageTokens: languageTokens$
		}).pipe(
			map(({ items: documentSymbols, languageTokens }) => {
				const string = Symbol.for("string")
				const paints: [string, string][] = []

				for (const documentSymbol of documentSymbols) {
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
										paints.push([value, languageTokens.get(null, string, item_name)![0].detail!])
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
										const name = languageTokens.get(null, string, item_name)![0].detail!
										paints.push([value, `${name} (Red)`], [value2, `${name} (Blu)`])
									}
								}
								break
							}
							default:
								continue
						}
					}
				}

				return new Map(paints.sort((a, b) => a[0].localeCompare(b[0])))
			})
		)

		const effects$ = languageTokens$.pipe(
			map((languageTokens) => {
				const attrib_particle = "Attrib_Particle".toLowerCase()
				return new Map(
					languageTokens
						.ofType(null, Symbol.for("string"))
						.values()
						.filter(([definition]) => definition.key.toLowerCase().startsWith(attrib_particle))
						.map(([definition]) => [definition.key.substring(attrib_particle.length), definition.detail!])
				)
			})
		)

		this.paints = firstValueFrom(paints$)
		this.effects = firstValueFrom(effects$)

		const globals$ = combineLatest([itemsDefinitions, this.gameSounds$]).pipe(
			take(1),
			shareReplay(1)
		)

		this.dependencies = firstValueFrom(
			combineLatest({
				attributes: attributes,
				paints: this.paints,
				effects: this.effects
			}).pipe(
				map(({ attributes, paints, effects }) => {
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
						globals$: globals$
					}
				})
			)
		)

		this.maps = new Map()
	}

	public entities(uri: Uri) {
		if (uri.extname() != ".pop") {
			throw new Error(`[PopfileWorkspace.entities] "${uri}" != ".pop"`)
		}

		return findMap(uri, this.fileSystem).pipe(
			concatMap(async (bsp) => {
				if (!bsp) {
					return null
				}

				return await this.maps.getOrInsertComputed(bsp, async () => {
					const entry = await firstValueFrom(this.fileSystem.resolve(`maps/${bsp}`))
					if (entry.type != EntryType.File) {
						return null
					}

					const entities = await this.server.trpc.client.popfile.bsp.entities.query({ uri: entry.uri }).then((entities) => entities && Map.groupBy(entities, (item) => item.classname))
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
								events.getOrInsert(parameter.toLowerCase(), parameter)
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
				})
			})
		)
	}
}
