import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { firstValueFrom, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CompletionItem, CompletionItemKind } from "vscode-languageserver"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "../../DefinitionReferences"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VDFTextDocumentSchema } from "../VDFTextDocument"
import type { PopfileLanguageServer } from "./PopfileLanguageServer"
import type { PopfileTextDocument } from "./PopfileTextDocument"

export class PopfileWorkspace extends WorkspaceBase {

	public readonly paints: Promise<Map<string, string>>
	public readonly dependencies: Promise<{
		schema: {
			keys: VDFTextDocumentSchema<PopfileTextDocument>["keys"],
		},
		globals$: Observable<DefinitionReferences[]>
	}>

	private readonly maps: Map<string, Promise<{ values: VDFTextDocumentSchema<PopfileTextDocument>["values"], completion: { values: VDFTextDocumentSchema<PopfileTextDocument>["completion"]["values"] } } | null>>
	private readonly classIcons: Map<string, Observable<{ uri: Uri, flags: number } | null>>

	constructor(
		private readonly fileSystem: FileSystemMountPoint,
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
						documentation: undefined,
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

		this.dependencies = Promise.all([items, attributes, this.paints]).then(([items, attributes, paints]) => {
			return {
				schema: {
					keys: {
						...attributes.keys,
					},
					values: {
						[`${"set item tint RGB".toLowerCase()}`]: paints
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
					}
				},
				globals$: of([items])
			}
		})

		this.maps = new Map()
		this.classIcons = new Map()
	}

	public async entities(basename: string) {
		if (posix.extname(basename) != ".pop") {
			return null
		}

		const maps = await this.fileSystem.readDirectory("maps", { pattern: "mvm_*.bsp" })
		const bsp = maps
			.values()
			.filter(([, type]) => type == 1)
			.map(([name]) => posix.parse(name).name)
			.filter((name) => basename.startsWith(name))
			.toArray()
			.toSorted((a, b) => basename.substring(a.length).length - basename.substring(b.length).length)[0]

		console.log(`${basename} => ${bsp != undefined ? `${bsp}.bsp` : null}`)

		if (!bsp) {
			return null
		}

		if (!this.maps.has(bsp)) {
			this.maps.set(bsp, Promise.try(async () => {
				const uri = await firstValueFrom(this.fileSystem.resolveFile(`maps/${bsp}.bsp`))
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
							[`${"StartingPathTrackNode".toLowerCase()}`]: pathTracks.map((value) => ({ label: value, kind: CompletionItemKind.Enum })),
							[`${"Target".toLowerCase()}`]: targets.map((value) => ({ label: value, kind: CompletionItemKind.Enum })),
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
					if (uri == null) {
						return of(null)
					}

					return new Observable<Uri | null>((subscriber) => {
						return this.server.trpc.servers.vmt.baseTexture.subscribe({ uri }, {
							onData: (value) => subscriber.next(value),
							onError: (err) => subscriber.error(err),
							onComplete: () => subscriber.complete(),
						})
					}).pipe(
						switchMap((uri) => {
							if (uri == null) {
								return of(null)
							}

							return new Observable<number>((subscriber) => {
								return this.server.trpc.client.popfile.classIcon.flags.subscribe({ uri }, {
									onData: (value) => subscriber.next(value),
									onError: (err) => subscriber.error(err),
									onComplete: () => subscriber.complete(),
								})
							}).pipe(
								map((flags) => ({ uri, flags }))
							)
						})
					)
				}),
				shareReplay(1)
			)

			this.classIcons.set(icon, flags$)
		}

		return flags$
	}
}
