import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import type { FileSystemKey } from "common/FileSystemKey"
import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import { usingAsync } from "common/operators/usingAsync"
import { findMap } from "common/popfile/findMap"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { HUDAnimationsDocumentSymbols } from "hudanimations-documentsymbols"
import { posix } from "path"
import { catchError, combineLatest, concatMap, distinctUntilChanged, finalize, first, firstValueFrom, map, of, pairwise, shareReplay, startWith, switchMap, tap, type Observable, type Subscription } from "rxjs"
import type { VDFText } from "vdf-documentsymbols"
import type { Connection } from "vscode-languageserver"
import { z } from "zod"
import { BaseDocument } from "./BaseDocument"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "./DefinitionReferences"
import { types, type DefinitionType } from "./DefinitionTypes"
import { HUDAnimationsTextDocument } from "./HUDAnimations/HUDAnimationsTextDocument"
import type { TextDocument } from "./VDFLanguageServer"

export interface GlobalDefinitionReferences {
	readonly definitions$: Observable<Definitions>
	setReferences?(uri: Uri, references: References): { remove(): void }
}

export const enum VDFFileType {
	None,
	ClientScheme,
	SourceScheme,
	ChatScheme,
	LanguageTokens,
	GameMenu,
	ItemsGame,
	HUDAnimationsManifest,
	GameSoundsManifest,
	GameSounds,
	SurfacePropertiesManifest,
	SurfaceProperties,
}

interface VGUIFiles {
	readonly clientScheme: Set<string>
	readonly sourceScheme: Set<string>
	readonly chatScheme: Set<string>
	readonly languageTokens: Set<string>
	readonly gameSounds: Set<string>
	readonly surfaceProperties: Set<string>
}

interface HUDAnimationsDocument {
	readonly uri: Uri,
	readonly version: number,
	readonly documentSymbols: HUDAnimationsDocumentSymbols,
	readonly definitionReferences: DefinitionReferences & {
		readonly elementReferences: Map<string, Collection<VDFText>>
	}
}

export interface BSP {
	readonly bsp: `mvm_${string}.bsp`,
	readonly teamSpawns: string[],
	readonly pathTracks: string[],
	readonly targets: string[],
	readonly events: Map<string, string>,
}

export class VDFWorkspace extends AsyncDisposableBase {

	private static readonly files: VGUIFiles = {
		clientScheme: new Set([
			"resource/clientscheme.res"
		]),
		sourceScheme: new Set([
			"resource/sourcescheme.res",
			"resource/SourceSchemeBase.res"
		]),
		chatScheme: new Set([
			"resource/chatscheme.res"
		]),
		languageTokens: new Set([
			"resource/chat_english.txt",
			"resource/tf_english.txt"
		]),
		gameSounds: new Set([
			"scripts/game_sounds.txt",
			"scripts/game_sounds_physics.txt",
			"scripts/game_sounds_weapons.txt",
			"scripts/game_sounds_vo.txt",
			"scripts/game_sounds_vo_handmade.txt",
			"scripts/game_sounds_music.txt",
			"scripts/game_sounds_player.txt",
			"scripts/game_sounds_mvm.txt",
			"scripts/game_sounds_vo_mvm_handmade.txt",
			"scripts/game_sounds_vo_rd_robots.txt",
			"scripts/game_sounds_vo_taunts.txt",
			"scripts/game_sounds_taunt_workshop.txt",
			"scripts/game_sounds_vo_pauling.txt",
			"scripts/game_sounds_vo_merasmus.txt",
			"scripts/game_sounds_vo_tough_break.txt",
			"scripts/game_sounds_passtime.txt",
		]),
		surfaceProperties: new Set([
			"scripts/surfaceproperties.txt",
			"scripts/surfaceproperties_hl2.txt",
			"scripts/surfaceproperties_tf.txt",
		])
	}

	private static readonly manifestFileKeys = {
		"game_sounds_manifest": new Set(["precache_file", "preload_file"]),
		"hudanimations_manifest": new Set(["file"]),
		"surfaceproperties_manifest": new Set(["file"]),
	}

	private static getFileType(files: VGUIFiles, path: string): VDFFileType {
		if (files.clientScheme.has(path)) {
			return VDFFileType.ClientScheme
		}
		else if (files.sourceScheme.has(path)) {
			return VDFFileType.SourceScheme
		}
		else if (files.chatScheme.has(path)) {
			return VDFFileType.ChatScheme
		}
		else if (files.languageTokens.has(path)) {
			return VDFFileType.LanguageTokens
		}
		else if (path == "resource/gamemenu.res") {
			return VDFFileType.GameMenu
		}
		else if (path == "scripts/items/items_game.txt") {
			return VDFFileType.ItemsGame
		}
		else if (path == "scripts/hudanimations_manifest.txt") {
			return VDFFileType.HUDAnimationsManifest
		}
		else if (path == "scripts/game_sounds_manifest.txt") {
			return VDFFileType.GameSoundsManifest
		}
		else if (files.gameSounds.has(path)) {
			return VDFFileType.GameSounds
		}
		else if (path == "scripts/surfaceproperties_manifest.txt") {
			return VDFFileType.SurfacePropertiesManifest
		}
		else if (files.surfaceProperties.has(path)) {
			return VDFFileType.SurfaceProperties
		}
		else {
			return VDFFileType.None
		}
	}

	public readonly uri: Uri
	private readonly connection: Connection
	private readonly fileSystem: FileSystemMountPoint
	private readonly fileSystems: RefCountAsyncDisposableFactory<FileSystemKey[], FileSystemMountPoint>
	private readonly teamFortress2Folder: Uri
	private readonly workspaceUris: Uri[]
	private readonly documents: RefCountAsyncDisposableFactory<Uri, TextDocument>
	private readonly trpc: TRPCClient<ClientRouter>
	private readonly workspaceDocuments: Map<string, Observable<TextDocument>>

	// Client Scheme
	public readonly clientSchemeFiles$: Observable<Set<string>>
	public readonly clientScheme: GlobalDefinitionReferences

	// Source Scheme
	public readonly sourceSchemeFiles$: Observable<Set<string>>

	// Chat Scheme
	public readonly chatSchemeFiles$: Observable<Set<string>>

	// Language Tokens
	public readonly languageTokensFiles$: Observable<Set<string>>
	public readonly languageTokens: GlobalDefinitionReferences

	// HUD Animations
	public readonly HUDAnimations$: Observable<{ path: string, uri: Uri, document$: Observable<HUDAnimationsDocument | null> }[]>

	// Game Sounds
	public readonly gameSoundsFiles$: Observable<Set<string>>
	public readonly gameSounds$: Observable<Definitions>

	// Surface Properties
	public readonly surfacePropertiesFiles$: Observable<Set<string>>
	public readonly surfaceProperties$: Observable<Definitions>

	// VGUI Files
	private readonly VGUIFiles$: Observable<VGUIFiles>

	public readonly itemsGame$: Observable<Definitions>
	public readonly paints$: Observable<Map<string, string>>
	public readonly effects$: Observable<Map<string, string>>

	private readonly maps: Map<string, Promise<BSP | null>>
	private readonly filesReferences: Map<
		string,
		{
			readonly document$: Observable<{ previous: TextDocument | null, current: TextDocument | null }>,
			readonly deleteOnRefCountZero: boolean,
			readonly documentReferences: Map<string, { readonly references: References, connected: boolean, remove?: { remove(): void } }>
			subscription?: Subscription
			refCount: number,
		}
	>

	private _hudAnimationsReferences?: Promise<void>
	private _vguiReferences?: Promise<void>

	public constructor({
		uri,
		connection,
		fileSystem,
		fileSystems,
		teamFortress2Folder,
		workspaceUris,
		documents,
		trpc,
	}: {
		uri: Uri,
		connection: Connection,
		fileSystem: FileSystemMountPoint,
		fileSystems: RefCountAsyncDisposableFactory<FileSystemKey[], FileSystemMountPoint>,
		teamFortress2Folder: Uri,
		workspaceUris: Uri[],
		documents: RefCountAsyncDisposableFactory<Uri, TextDocument>,
		trpc: TRPCClient<ClientRouter>,
	}) {
		super()
		this.uri = uri
		this.connection = connection
		this.fileSystem = this.stack.use(fileSystem)
		this.fileSystems = fileSystems
		this.teamFortress2Folder = teamFortress2Folder
		this.workspaceUris = workspaceUris
		this.documents = documents
		this.trpc = trpc
		this.workspaceDocuments = new Map()

		const files = (path: `resource/${"chat" | "client" | "source"}scheme.res` | string, seen: string[] = []): Observable<string[]> => {
			const dirname = posix.dirname(path)
			const self = path.toLowerCase()
			return this.getDocument(path).pipe(
				switchMap((document) => {
					if (document.languageId != "vdf") {
						throw new Error(document.languageId)
					}

					return document.documentSymbols$
				}),
				map((documentSymbols) => BaseDocument.base(documentSymbols)),
				distinctUntilChanged((previous, current) => previous.length == current.length && previous.every((detail, index) => detail == current[index])),
				combineLatestPersistent({
					entries: (value) => value.map((value) => ({ key: value })),
					observableSelector: (entry) => {
						const base = posix.resolve(`/${dirname}/${entry.key}`).substring(1)
						const key = base.toLowerCase()
						if (key == self || seen.some((path) => path.toLowerCase() == key)) {
							return of([])
						}

						return files(base, [...seen, path])
					},
					resultSelector: (base, results) => [path, ...results.flat()]
				}),
				catchError(() => of([])),
			)
		}

		const definitions = (path: string, encoding = "utf-8"): Observable<Definitions> => {
			return this.getDocument(path, encoding).pipe(
				switchMap((document) => document.definitions$),
				distinctUntilChanged((previous, current) => {
					return previous.version.length == current.version.length
						&& previous.version.every((value, index) => value == current.version[index])
				}),
				shareReplayUntilDisposed(this.dispose$),
			)
		}

		const manifest = (type: keyof typeof VDFWorkspace.manifestFileKeys): Observable<string[]> => {
			const path = <const>`scripts/${type}.txt`
			return this.getDocument(path).pipe(
				switchMap((document) => {
					if (document.languageId != "vdf") {
						throw new Error(document.languageId)
					}

					return document.documentSymbols$
				}),
				map((documentSymbols) => {
					const manifest = documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children ?? []

					return manifest
						.values()
						.filter((documentSymbol) => VDFWorkspace.manifestFileKeys[type].has(documentSymbol.key.text.toLowerCase()) && documentSymbol.value?.text.trim().length)
						.map((documentSymbol) => posix.resolve(`/${documentSymbol.value!.text}`).substring(1))
						.toArray()
				}),
				distinctUntilChanged((previous, current) => previous.length == current.length && previous.every((detail, index) => detail == current[index])),
				shareReplayUntilDisposed(this.dispose$),
			)
		}

		const manifests = {
			game_sounds_manifest: manifest("game_sounds_manifest"),
			hudanimations_manifest: manifest("hudanimations_manifest"),
			surfaceproperties_manifest: manifest("surfaceproperties_manifest"),
		}

		const manifestDefinitions = (name: keyof typeof VDFWorkspace.manifestFileKeys, type: DefinitionType): Observable<Definitions> => {
			return manifests[name].pipe(
				tap((paths) => {
					if (paths.length == 0) {
						console.warn(`${name}.length == 0`)
					}
				}),
				combineLatestPersistent({
					entries: (paths) => paths.map((value) => ({ key: value })),
					observableSelector: (entry) => {
						return fileSystem.resolve(entry.key).pipe(
							switchMap((entry) => {
								if (entry.type != EntryType.File) {
									return of(null)
								}

								return usingAsync(async () => await documents.get(entry.uri)).pipe(
									switchMap((document) => document.definitions$),
								)
							})
						)
					},
					resultSelector: (value, results) => results.filter((result) => result != null),
				}),
				map((dependencies) => {
					const collection = new Collection<Definition>

					for (const definitions of dependencies) {
						for (const [key, value] of definitions.ofType(null, type)) {
							collection.set(null, type, key, ...value)
						}
					}

					return new Definitions(
						dependencies.flatMap((definitions) => definitions.version),
						collection
					)
				}),
				shareReplayUntilDisposed(this.dispose$),
			)
		}

		// Client Scheme
		const clientscheme = "resource/clientscheme.res"
		this.clientSchemeFiles$ = files(clientscheme).pipe(
			map((paths) => new Set(paths.map((path) => path.toLowerCase()))),
			shareReplayUntilDisposed(this.dispose$),
		)
		this.clientScheme = {
			definitions$: definitions(clientscheme),
			setReferences: (uri, references) => {
				return this.setFileReferences(clientscheme, uri, references)
			},
		}

		// Source Scheme
		const sourcescheme = "resource/sourcescheme.res"
		this.sourceSchemeFiles$ = files(sourcescheme).pipe(
			map((paths) => new Set(paths.map((path) => path.toLowerCase()))),
			shareReplayUntilDisposed(this.dispose$),
		)

		// Chat Scheme
		this.chatSchemeFiles$ = files("resource/chatscheme.res").pipe(
			map((paths) => new Set(paths.map((path) => path.toLowerCase()))),
			shareReplayUntilDisposed(this.dispose$),
		)

		// Language Tokens
		this.languageTokensFiles$ = of(VDFWorkspace.files.languageTokens).pipe(
			shareReplayUntilDisposed(this.dispose$),
		)

		this.languageTokens = {
			definitions$: combineLatest([
				definitions("resource/chat_english.txt", "utf-16le"),
				definitions("resource/tf_english.txt", "utf-16le"),
			]).pipe(
				map((dependencies) => {
					const collection = new Collection<Definition>()

					for (const definitions of dependencies) {
						for (const [key, value] of definitions.ofType(null, types.string)) {
							collection.set(null, types.string, key, ...value)
						}
					}

					return new Definitions(
						dependencies.flatMap((definitions) => definitions.version),
						collection,
					)
				}),
				shareReplayUntilDisposed(this.dispose$),
			),
			setReferences: (uri, references) => {
				const chat_english = this.setFileReferences("resource/chat_english.txt", uri, references)
				const tf_english = this.setFileReferences("resource/tf_english.txt", uri, references)
				return {
					remove: () => {
						chat_english.remove()
						tf_english.remove()
					}
				}
			},
		}

		// HUD Animations
		this.HUDAnimations$ = manifests.hudanimations_manifest.pipe(
			combineLatestPersistent({
				entries: (value) => value.map((value) => ({ key: value })),
				observableSelector: (entry) => {
					const path = entry.key
					return this.fileSystem.resolve(path).pipe(
						map((entry) => {
							if (entry.type != EntryType.File) {
								return null
							}

							return {
								path: path,
								uri: entry.uri,
								document$: usingAsync(async () => {
									const query = new URLSearchParams(entry.uri.query)
									query.set("language", "hudanimations")
									const uri = entry.uri.with({ query: query.toString() })
									return await this.documents.get(uri)
								}).pipe(
									switchMap((document) => {
										if (document.languageId != "hudanimations") {
											throw new Error(document.languageId)
										}

										return document.documentSymbols$.pipe(
											map((documentSymbols) => {
												return {
													uri: document.uri,
													version: document.version,
													documentSymbols: documentSymbols,
													definitionReferences: HUDAnimationsTextDocument.definitionReferences(document, documentSymbols),
												} satisfies HUDAnimationsDocument
											}),
										)
									}),
									catchError(() => of(null))
								)
							}
						})
					)
				},
				resultSelector: (value, results) => {
					return results.filter((result) => result != null)
				}
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		// Game Sounds
		this.gameSoundsFiles$ = manifests.game_sounds_manifest.pipe(
			map((paths) => new Set(paths.map((path) => path.toLowerCase()))),
			shareReplayUntilDisposed(this.dispose$),
		)
		this.gameSounds$ = manifestDefinitions("game_sounds_manifest", types.gamesound)

		// Surface Properties
		this.surfacePropertiesFiles$ = manifests.surfaceproperties_manifest.pipe(
			map((paths) => new Set(paths.map((path) => path.toLowerCase()))),
			shareReplayUntilDisposed(this.dispose$),
		)
		this.surfaceProperties$ = manifestDefinitions("surfaceproperties_manifest", types.surfaceprop)

		this.VGUIFiles$ = combineLatest({
			clientScheme: this.clientSchemeFiles$,
			sourceScheme: this.sourceSchemeFiles$,
			chatScheme: this.chatSchemeFiles$,
			languageTokens: this.languageTokensFiles$,
			gameSounds: this.gameSoundsFiles$,
			surfaceProperties: this.surfacePropertiesFiles$,
		}).pipe(
			shareReplayUntilDisposed(this.dispose$),
		)

		const items_game = "scripts/items/items_game.txt"
		const itemsGame$ = this.fileSystem.resolve(items_game).pipe(
			switchMap((entry) => {
				if (entry.type != EntryType.File) {
					throw new Error(items_game)
				}

				return usingAsync(async () => await documents.get(entry.uri))
			}),
			map((document) => {
				if (document.languageId != "vdf") {
					throw new Error(document.languageId)
				}

				return document
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.itemsGame$ = itemsGame$.pipe(
			switchMap((document) => document.definitions$),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.paints$ = combineLatest({
			itemsGame: itemsGame$.pipe(switchMap((document) => document.documentSymbols$)),
			languageTokens: this.languageTokens.definitions$,
		}).pipe(
			map(({ itemsGame, languageTokens }) => {
				const items_game = itemsGame.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "items_game")?.children
				if (!items_game) {
					throw new Error("items_game")
				}

				const items = items_game.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "items")?.children
				if (!items) {
					throw new Error("items")
				}

				const paints: [string, string][] = []

				for (const documentSymbol of items) {
					const prefab = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "prefab")?.value?.text.toLowerCase()
					if (prefab == "valve paint_can" || prefab == "valve paint_can_team_color") {
						const item_name = types.string.toDefinition(documentSymbol.children!.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "item_name")!.value!.text)
						const attributes = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "attributes")?.children
						if (!item_name || !attributes) {
							continue
						}

						switch (prefab) {
							case "valve paint_can":
								const rgb = attributes.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "set item tint RGB".toLowerCase())?.children
								if (rgb) {
									const value = rgb.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "value")?.value?.text
									if (value) {
										paints.push([value, languageTokens.get(null, types.string, item_name)![0].detail!])
									}
								}
								break
							case "valve paint_can_team_color": {
								const rgb = attributes.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "set item tint RGB".toLowerCase())?.children
								const rgb2 = attributes.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "set item tint RGB 2".toLowerCase())?.children
								if (rgb && rgb2) {
									const value = rgb.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "value")?.value?.text
									const value2 = rgb2.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "value")?.value?.text
									if (value && value2) {
										const name = languageTokens.get(null, types.string, item_name)![0].detail!
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
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.effects$ = this.languageTokens.definitions$.pipe(
			map((languageTokens) => {
				const attrib_particle = "Attrib_Particle".toLowerCase()
				return new Map(
					languageTokens
						.ofType(null, types.string)
						.values()
						.filter(([definition]) => definition.key.toLowerCase().startsWith(attrib_particle))
						.map(([definition]) => [definition.key.substring(attrib_particle.length), definition.detail!])
				)
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.maps = new Map()
		this.filesReferences = new Map(
			["resource/chat_english.txt", "resource/tf_english.txt"].map((path) => <const>[
				path,
				{
					document$: this.getDocument(path, "utf-16le").pipe(
						startWith(null),
						pairwise(),
						map(([previous, current]) => ({ previous, current }))
					),
					deleteOnRefCountZero: false,
					documentReferences: new Map(),
					subscription: undefined,
					refCount: 0,
				}
			])
		)

		this.stack.defer(() => {
			for (const fileReferences of this.filesReferences.values()) {
				fileReferences.subscription?.unsubscribe()
			}
		})
	}

	private getDocument(path: string, encoding = "utf-8") {
		return this.workspaceDocuments.getOrInsertComputed(path, () => {
			return this.fileSystem.resolve(path).pipe(
				switchMap((entry) => {
					if (entry.type != EntryType.File) {
						throw new Error(path)
					}

					const query = new URLSearchParams(entry.uri.query)
					query.set("encoding", encoding)
					query.sort()

					const uri = entry.uri.with({ query: query.toString() })
					return usingAsync(async () => await this.documents.get(uri))
				}),
				finalize(() => {
					this.workspaceDocuments.delete(path)
				}),
				shareReplay({ bufferSize: 1, refCount: true })
			)
		})
	}

	public async HUDAnimationsReferences() {
		return await (this._hudAnimationsReferences ??= firstValueFrom(
			this.HUDAnimations$.pipe(
				switchMap((HUDAnimations) => {
					return HUDAnimations.length > 0
						? combineLatest(HUDAnimations.map((file) => file.document$))
						: of([])
				}),
				map(() => undefined)
			)
		))
	}

	public async VGUIReferences() {
		return await (this._vguiReferences ??= Promise.try(async () => {
			const reporter = await this.connection.window.createWorkDoneProgress()
			reporter.begin("Indexing", 0)

			await using fileSystem = await this.fileSystems.get([
				...(!Uri.equals(this.uri, this.teamFortress2Folder.joinPath("tf")) ? [{ type: <const>"folder", folder: this.uri }] : []),
				...(this.teamFortress2Folder.scheme != "vscode-vdf-tf-remote-resource" ? [{ type: <const>"tf2", teamFortress2Folder: this.teamFortress2Folder }] : []),
				...this.workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
			])

			const options = { recursive: true, pattern: "**/*.res" }

			const readDirectory = async function*(folder: string) {
				const entries = await fileSystem.readDirectory(folder, options)
				yield* entries
					.values()
					.filter(([_path, type]) => type == 1)
					.map(([path, _type]) => posix.join(folder, path))
			}

			const entries = async function*() {
				yield* readDirectory("resource/ui")
				yield* readDirectory("scripts")
			}

			const folders = Map.groupBy(
				await Array.fromAsync(entries()),
				(path) => posix.dirname(path)
			)

			const stack = new AsyncDisposableStack()
			this.stack.defer(async () => await stack.disposeAsync())

			for (const [index, folder] of [...folders.keys()].sort().entries()) {
				reporter.report(index / folders.size, `${index + 1}/${folders.size} (${folder})`)

				await Promise.all(
					folders.get(folder)!.map(async (path) => {
						const entry = await firstValueFrom(fileSystem.resolve(path))
						if (entry.type == EntryType.File) {
							stack.use(await this.documents.get(entry.uri))
						}
					})
				)
			}

			await stack.disposeAsync()

			setTimeout(() => {
				reporter.done()
			}, 1000)
		}))
	}

	public fileType(path: string) {
		return this.VGUIFiles$.pipe(
			map((files) => VDFWorkspace.getFileType(files, path.toLowerCase())),
			distinctUntilChanged()
		)
	}

	public elements(path: string) {
		return this.getDocument(path).pipe(
			switchMap((document) => document.definitions$.pipe(
				map((definitions) => ({ uri: document.uri, definitions: definitions }))
			)),
		)
	}

	public entities(uri: Uri) {
		const extname = uri.extname()
		if (extname != ".pop") {
			throw new Error(`${uri.toString()}: "${extname}" != ".pop"`)
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

					const entities = await this.trpc.popfile.bsp.entities.query({ uri: entry.uri }).then((entities) => entities && Map.groupBy(entities, (item) => item.classname))
					if (!entities) {
						return null
					}

					console.log(`${bsp}:`)
					console.dir(entities, { depth: Infinity })

					// Where
					const teamSpawns = [
						...new Set(
							entities
								.get("info_player_teamspawn")
								?.toSorted((a, b) => (<string | undefined>b["TeamNum"])?.localeCompare(<string>a["TeamNum"]) || a.targetname?.localeCompare(b.targetname!) || 0)
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
								.get("path_track")
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
								.values()
								.flatMap((value) => value)
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
							const [target, input, parameter, _delay, _once] = trigger.split(",")
							if (target != undefined && input != undefined && parameter != undefined && target == populator && (input.toLowerCase() == "ChangeBotAttributes" || input.toLowerCase() == "ChangeDefaultEventAttributes".toLowerCase())) {
								events.getOrInsert(parameter.toLowerCase(), parameter)
							}
						}
					}

					return {
						bsp: bsp,
						teamSpawns: teamSpawns,
						pathTracks: pathTracks,
						targets: targets,
						events: events,
					}
				})
			})
		)
	}

	public setFileReferences(path: string, uri: Uri, references: References): { remove(): void } {
		const pathReferences = this.filesReferences.getOrInsertComputed(path, () => {
			return {
				document$: this.getDocument(path).pipe(
					catchError(() => of(null)),
					startWith(null),
					pairwise(),
					map(([previous, current]) => ({ previous, current }))
				),
				deleteOnRefCountZero: true,
				documentReferences: new Map(),
				subscription: undefined,
				refCount: 0,
			}
		})

		pathReferences.subscription ??= pathReferences.document$.subscribe(({ previous, current }) => {
			if (previous != null) {
				for (const documentReferences of pathReferences.documentReferences.values()) {
					documentReferences.remove?.remove()
					documentReferences.remove = undefined
				}
			}

			if (current != null) {
				for (const documentReferences of pathReferences.documentReferences.values()) {
					documentReferences.remove = current.setReferences(documentReferences.references.uri, documentReferences.references)
				}
			}
		})

		const key = uri.toString()
		pathReferences.refCount += 1

		let documentReferences = pathReferences.documentReferences.get(key)
		if (documentReferences?.connected) {
			throw new Error(`[VDFWorkspace] Already set ${uri.toString()} references for ${path}`)
		}

		documentReferences = pathReferences.documentReferences.getOrInsertComputed(key, () => ({ references, connected: true }))

		pathReferences.document$.pipe(first()).subscribe(({ current }) => {
			if (current != null) {
				const references = documentReferences.references
				documentReferences.remove ??= current.setReferences(references.uri, references)
			}
		})

		// Allow reconnect
		documentReferences.references.next$.subscribe({
			complete: () => documentReferences.connected = false
		})

		return {
			remove: () => {
				pathReferences.documentReferences.get(key)?.remove?.remove()
				pathReferences.documentReferences.delete(key)
				pathReferences.refCount -= 1

				if (pathReferences.refCount == 0 && pathReferences.deleteOnRefCountZero) {
					pathReferences.subscription?.unsubscribe()
					pathReferences.subscription = undefined
					this.filesReferences.delete(path)
				}
			}
		}
	}
}
