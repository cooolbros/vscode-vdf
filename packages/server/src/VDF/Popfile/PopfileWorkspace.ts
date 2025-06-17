import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { usingAsync } from "common/operators/usingAsync"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { combineLatestWith, firstValueFrom, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CompletionItemKind } from "vscode-languageserver"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VDFTextDocumentSchema } from "../VDFTextDocument"
import type { PopfileTextDocument } from "./PopfileTextDocument"

export class PopfileWorkspace extends WorkspaceBase {

	public readonly items$: Observable<Pick<VDFTextDocumentSchema, "keys" | "values">>
	public readonly attributes$: Observable<Pick<VDFTextDocumentSchema, "keys" | "values">>
	public readonly paints$: Observable<Map<string, string>>

	private readonly maps: Map<string, Promise<{ values: VDFTextDocumentSchema["values"], completion: { values: VDFTextDocumentSchema["completion"]["values"] } } | null>>
	private readonly classIcons: Map<string, Observable<{ uri: Uri, flags: number } | null>>

	constructor(
		private readonly fileSystem: FileSystemMountPoint,
		private readonly getEntities: (uri: Uri) => Promise<Record<string, string>[] | null>,
		private readonly getClassIconFlags: (uri: Uri) => Observable<{ uri: Uri, flags: number } | null>,
		documents: RefCountAsyncDisposableFactory<Uri, PopfileTextDocument>,
	) {
		super(new Uri({ scheme: "file", path: "/" }))

		const items_game$ = this.fileSystem.resolveFile("scripts/items/items_game.txt").pipe(
			switchMap((uri) => usingAsync(async () => await documents.get(uri!))),
			switchMap((document) => document.documentSymbols$),
			map((documentSymbols) => documentSymbols.find((documentSymbol) => documentSymbol.key == "items_game")?.children),
			map((items_game) => {
				if (!items_game) {
					throw new Error("items_game")
				}

				return items_game
			}),
			shareReplay(1)
		)

		function names(items_game: VDFDocumentSymbols, key: string) {
			return items_game
				?.find((documentSymbol) => documentSymbol.key == key)
				?.children
				?.values()
				.map((documentSymbol) => documentSymbol.children?.find((documentSymbol) => documentSymbol.key == "name")?.detail)
				.filter((name) => name != undefined)
		}

		const tf_english$ = this.fileSystem.resolveFile("resource/tf_english.txt").pipe(
			switchMap((uri) => usingAsync(async () => await documents.get(uri!))),
			switchMap((document) => document.text$),
			map((text) => getVDFDocumentSymbols(text, { multilineStrings: true })),
			map((documentSymbols) => {
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
			}),
			shareReplay(1)
		)

		this.items$ = items_game$.pipe(
			map((documentSymbols) => {
				const items = names(documentSymbols, "items")?.drop(1).toArray()
				if (!items) {
					throw new Error("items")
				}

				return {
					keys: {},
					values: {
						item: {
							kind: CompletionItemKind.Constant,
							values: items
						},
						itemname: {
							kind: CompletionItemKind.Constant,
							values: items
						},
					}
				}
			}),
			shareReplay(1)
		)

		this.attributes$ = items_game$.pipe(
			map((documentSymbols) => {
				const attributes = names(documentSymbols, "attributes")?.map((attribute) => ({ label: attribute, kind: CompletionItemKind.Field })).toArray()
				if (!attributes) {
					throw new Error("attributes")
				}

				return {
					keys: {
						characterattributes: {
							values: attributes
						},
						itemattributes: {
							values: [
								{
									label: "ItemName",
									kind: CompletionItemKind.Field
								},
								...attributes
							]
						}
					},
					values: {}
				}
			}),
			shareReplay(1)
		)

		this.paints$ = items_game$.pipe(
			combineLatestWith(tf_english$),
			map(([documentSymbols, tokens]) => {
				const items = documentSymbols?.find((documentSymbol) => documentSymbol.key == "items")?.children
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
										paints[value] = tokens.get(item_name)!
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
										paints[value] = `${tokens.get(item_name)!} (Red)`
										paints[value2] = `${tokens.get(item_name)!} (Blu)`
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
			}),
			shareReplay(1)
		)

		this.maps = new Map()
		this.classIcons = new Map()
	}

	public async entities(basename: string) {
		const maps = await this.fileSystem.readDirectory("maps", { pattern: "mvm_*.bsp" })
		const bsp = maps
			.values()
			.filter(([, type]) => type == 1)
			.find(([name]) => basename.startsWith(posix.parse(name).name))
			?.[0]

		if (!bsp) {
			return null
		}

		if (!this.maps.has(bsp)) {
			this.maps.set(bsp, Promise.try(async () => {
				const uri = await firstValueFrom(this.fileSystem.resolveFile(`maps/${bsp}`))
				if (!uri) {
					return null
				}

				const entities = await this.getEntities(uri).then((entities) => entities && Map.groupBy(entities, (item) => item["classname"]))
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

				return {
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
							startingpathtracknode: {
								kind: CompletionItemKind.Enum,
								values: pathTracks
							},
							target: {
								kind: CompletionItemKind.Enum,
								values: targets
							},
						}
					}
				}
			}))
		}

		return await this.maps.get(bsp)!
	}

	public classIconFlags(icon: string) {
		let flags$ = this.classIcons.get(icon)
		if (!flags$) {
			flags$ = this.fileSystem.resolveFile(`materials/hud/leaderboard_class_${icon}.vmt`).pipe(
				switchMap((uri) => {
					return uri != null
						? this.getClassIconFlags(uri)
						: of(null)
				}),
				shareReplay(1)
			)

			this.classIcons.set(icon, flags$)
		}

		return flags$
	}
}
