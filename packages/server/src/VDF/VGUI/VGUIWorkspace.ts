import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { BehaviorSubject, combineLatest, distinctUntilChanged, firstValueFrom, map, of, pairwise, shareReplay, startWith, switchMap, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { Collection, Definitions, References, type Definition, type DefinitionReferences, type GlobalDefinitionReferences, type SetDocumentReferences } from "../../DefinitionReferences"
import { WorkspaceBase } from "../../WorkspaceBase"
import { VGUITextDocument } from "./VGUITextDocument"

export const enum VGUIFileType {
	None,
	ClientScheme,
	SourceScheme,
	ChatScheme,
	LanguageTokens,
	GameSounds,
	SurfaceProperties,
	ItemsGame,
	HUDAnimationsManifest,
	GameSoundsManifest,
	SurfacePropertiesManifest,
}

interface VGUIFiles {
	clientScheme: Set<string>
	sourceScheme: Set<string>
	chatScheme: Set<string>
	languageTokens: Set<string>
	gameSounds: Set<string>
	surfaceProperties: Set<string>
}

export class VGUIWorkspace extends WorkspaceBase {

	private static getFileType(files: VGUIFiles, path: string | null) {
		if (!path) {
			return VGUIFileType.None
		}

		if (files.clientScheme.has(path)) {
			return VGUIFileType.ClientScheme
		}
		else if (files.sourceScheme.has(path)) {
			return VGUIFileType.SourceScheme
		}
		else if (files.chatScheme.has(path)) {
			return VGUIFileType.ChatScheme
		}
		else if (files.languageTokens.has(path)) {
			return VGUIFileType.LanguageTokens
		}
		else if (files.gameSounds.has(path)) {
			return VGUIFileType.GameSounds
		}
		else if (files.surfaceProperties.has(path)) {
			return VGUIFileType.SurfaceProperties
		}
		else if (path == "scripts/items/items_game.txt") {
			return VGUIFileType.ItemsGame
		}
		else if (path == "scripts/hudanimations_manifest.txt") {
			return VGUIFileType.HUDAnimationsManifest
		}
		else if (path == "scripts/game_sounds_manifest.txt") {
			return VGUIFileType.GameSoundsManifest
		}
		else if (path == "scripts/surfaceproperties_manifest.txt") {
			return VGUIFileType.SurfacePropertiesManifest
		}
		else {
			return VGUIFileType.None
		}
	}

	private static readonly files: VGUIFiles = {
		clientScheme: new Set(["resource/clientscheme.res"]),
		sourceScheme: new Set(["resource/sourcescheme.res", "resource/SourceSchemeBase.res"]),
		chatScheme: new Set(["resource/chatscheme.res"]),
		languageTokens: new Set(["resource/chat_english.txt", "resource/tf_english.txt"]),
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

	public static fileType(uri: Uri, teamFortress2Folder: Uri): VGUIFileType {
		let path: string | null
		switch (uri.scheme) {
			case "file":
				path = posix.relative(teamFortress2Folder.joinPath("tf").path, uri.path)
				break
			case "bsp":
			case "vpk":
				path = uri.path.substring(1)
				break
			default:
				// https://github.com/microsoft/vscode/blob/main/src/vs/base/common/network.ts
				console.warn(`Unknown Uri.scheme: ${uri}`)
				path = null
				break
		}

		return VGUIWorkspace.getFileType(VGUIWorkspace.files, path)
	}

	private readonly documents: RefCountAsyncDisposableFactory<Uri, VGUITextDocument>

	public readonly clientSchemeFiles$: Observable<Set<string>>
	public readonly clientScheme$: Observable<GlobalDefinitionReferences>

	public readonly sourceSchemeFiles$: Observable<Set<string>>
	public readonly chatSchemeFiles$: Observable<Set<string>>

	public readonly languageTokensFiles$: Observable<Set<string>>
	public readonly languageTokens$: Observable<GlobalDefinitionReferences>

	public readonly hudanimations_manifest$: Observable<string[]>

	public readonly game_sounds_manifest$: Observable<string[]>
	public readonly gameSoundsFiles$: Observable<Set<string>>
	public readonly gameSounds$: Observable<GlobalDefinitionReferences>

	public readonly surfaceproperties_manifest$: Observable<string[]>
	public readonly surfacePropertiesFiles$: Observable<Set<string>>
	public readonly surfaceProperties$: Observable<GlobalDefinitionReferences>

	public readonly itemsGame$: Observable<VGUITextDocument>

	public readonly globals$: Observable<GlobalDefinitionReferences[]>

	public readonly fileReferences: Map<string, { references$: BehaviorSubject<Map<string, References | null>>, document$: Observable<VGUITextDocument | null> }>

	constructor({
		uri,
		fileSystem,
		documents,
	}: {
		uri: Uri,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, VGUITextDocument>,
	}) {
		super(uri, fileSystem)
		this.documents = documents

		const files = (path: string): Observable<string[]> => {
			return fileSystem.resolve(path).pipe(
				switchMap((entry) => {
					if (entry.type != EntryType.File) {
						return of([path])
					}

					return usingAsync(async () => await documents.get(entry.uri)).pipe(
						switchMap((document) => document.documentSymbols$),
						map((documentSymbols) => {
							return documentSymbols
								.filter((documentSymbol) => documentSymbol.key == "#base" && documentSymbol.detail)
								.map((documentSymbol) => posix.resolve(`/${posix.dirname(path)}/${documentSymbol.detail}`).substring(1))
						}),
						distinctUntilChanged((previous, current) => {
							return previous.length == current.length && previous.every((path, index) => path == current[index])
						}),
						switchMap((paths) => {
							return paths.length
								? combineLatest(paths.map((path) => files(path))).pipe(map((paths) => paths.flat()))
								: new BehaviorSubject([])
						}),
						map((paths) => [path, ...paths]),
					)
				})
			)
		}

		const definitions = (path: string): Observable<GlobalDefinitionReferences> => {
			return fileSystem.resolve(path).pipe(
				switchMap((entry) => {
					if (entry.type != EntryType.File) {
						throw new Error(path)
					}

					return usingAsync(async () => await documents.get(entry.uri))
				}),
				switchMap((document) => document.definitionReferences$),
				distinctUntilChanged((previous, current) => {
					return true
						&& previous.definitions.version.length == current.definitions.version.length
						&& previous.definitions.version.every((value, index) => value == current.definitions.version[index])
				})
			)
		}

		const manifest = (path: string, keys: Set<string>) => {
			return fileSystem.resolve(path).pipe(
				switchMap((entry) => {
					if (entry.type != EntryType.File) {
						throw new Error(path)
					}

					return usingAsync(async () => await documents.get(entry.uri))
				}),
				switchMap((document) => document.documentSymbols$),
				map((documentSymbols) => {
					const manifest = documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children ?? []

					return manifest
						.filter((documentSymbol) => keys.has(documentSymbol.key.toLowerCase()) && documentSymbol.detail != undefined)
						.map((documentSymbol) => posix.resolve(`/${documentSymbol.detail!}`).substring(1))
				})
			)
		}

		this.clientSchemeFiles$ = files("resource/clientscheme.res").pipe(
			map((paths) => new Set(paths)),
			shareReplayUntilDisposed(this.dispose$),
		)
		this.clientScheme$ = definitions("resource/clientscheme.res").pipe(
			shareReplayUntilDisposed(this.dispose$),
		)

		this.sourceSchemeFiles$ = files("resource/sourcescheme.res").pipe(
			map((paths) => new Set(paths)),
			shareReplayUntilDisposed(this.dispose$),
		)
		this.chatSchemeFiles$ = files("resource/chatscheme.res").pipe(
			map((paths) => new Set(paths)),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.languageTokensFiles$ = combineLatest([files("resource/chat_english.txt"), files("resource/tf_english.txt")]).pipe(
			map((paths) => new Set(paths.flat())),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.languageTokens$ = combineLatest([
			definitions("resource/chat_english.txt"),
			definitions("resource/tf_english.txt")
		]).pipe(
			map((dependencies) => {
				const definitions = new Collection<Definition>()

				for (const definitionReferences of dependencies) {
					for (const definition of definitionReferences.definitions) {
						definitions.set(null, definition.type, definition.key, ...definition.value)
					}
				}

				return {
					scopes: new Map(),
					definitions: new Definitions({
						version: dependencies.flatMap(({ definitions }) => definitions.version),
						collection: definitions,
						globals: [],
					}),
					references: new References(this.uri, undefined, dependencies.map(({ references }) => references))
				} satisfies DefinitionReferences
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.hudanimations_manifest$ = manifest("scripts/hudanimations_manifest.txt", new Set(["file"]))

		this.game_sounds_manifest$ = manifest("scripts/game_sounds_manifest.txt", new Set(["precache_file", "preload_file"])).pipe(
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.gameSoundsFiles$ = this.game_sounds_manifest$.pipe(
			map((paths) => new Set(paths)),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.gameSounds$ = this.game_sounds_manifest$.pipe(
			map((paths) => {
				if (paths.length == 0) {
					console.warn(`hudanimations_manifest.length == 0`)
				}

				return paths.map((path) => ({ key: path }))
			}),
			combineLatestPersistent(({ key: path }) => {
				return fileSystem.resolve(path).pipe(
					switchMap((entry) => {
						if (entry.type != EntryType.File) {
							return of(null)
						}

						return usingAsync(async () => await documents.get(entry.uri)).pipe(
							switchMap((document) => document.definitionReferences$),
						)
					}),
				)
			}),
			map((results) => {
				const version: number[] = []
				const collection = new Collection<Definition>()
				const dependencies: SetDocumentReferences[] = []

				for (const fileDefinitionReferences of results.values().filter((result) => result != null)) {
					version.push(...fileDefinitionReferences.definitions.version)

					for (const { scope, type, key, value: baseDefinitions } of fileDefinitionReferences.definitions) {
						if (scope == null) {
							collection.set(null, type, key, ...baseDefinitions)
						}
					}

					dependencies.push(fileDefinitionReferences.references)
				}

				return {
					scopes: new Map(),
					definitions: new Definitions({ version: version, collection: collection }),
					references: new References(this.uri, new Collection<VDFRange>(), dependencies)
				} satisfies DefinitionReferences
			})
		)

		this.surfaceproperties_manifest$ = manifest("scripts/surfaceproperties_manifest.txt", new Set(["file"]))

		this.surfacePropertiesFiles$ = this.surfaceproperties_manifest$.pipe(
			map((paths) => new Set(paths)),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.surfaceProperties$ = this.surfaceproperties_manifest$.pipe(
			map((paths) => {
				if (paths.length == 0) {
					console.warn(`surfaceproperties_manifest.length == 0`)
				}

				return paths.map((path) => ({ key: path }))
			}),
			combineLatestPersistent(({ key: path }) => {
				return fileSystem.resolve(path).pipe(
					switchMap((entry) => {
						if (entry.type != EntryType.File) {
							return of(null)
						}

						return usingAsync(async () => await documents.get(entry.uri)).pipe(
							switchMap((document) => document.definitionReferences$),
						)
					}),
				)
			}),
			map((results) => {
				const version: number[] = []
				const collection = new Collection<Definition>()
				const dependencies: SetDocumentReferences[] = []

				for (const fileDefinitionReferences of results.values().filter((result) => result != null)) {
					version.push(...fileDefinitionReferences.definitions.version)

					for (const [key, baseDefinitions] of fileDefinitionReferences.definitions.ofType(null, Symbol.for("surfaceprop"))) {
						collection.set(null, Symbol.for("surfaceprop"), key, ...baseDefinitions)
					}

					dependencies.push(fileDefinitionReferences.references)
				}

				return {
					scopes: new Map(),
					definitions: new Definitions({ version: version, collection: collection }),
					references: new References(this.uri, new Collection<VDFRange>(), dependencies)
				} satisfies DefinitionReferences
			})
		)

		this.itemsGame$ = fileSystem.resolve("scripts/items/items_game.txt").pipe(
			switchMap((entry) => {
				if (entry.type != EntryType.File) {
					throw new Error("scripts/items/items_game.txt")
				}

				return usingAsync(async () => await documents.get(entry.uri))
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.globals$ = combineLatest([this.clientScheme$, this.languageTokens$]).pipe(
			shareReplayUntilDisposed(this.dispose$),
		)

		this.fileReferences = new Map()

		Promise.allSettled([
			Promise.try(async () => {
				const [clientSchemeFiles, sourceSchemeFiles, languageTokenFiles] = await Promise.all([
					firstValueFrom(this.clientSchemeFiles$),
					firstValueFrom(this.sourceSchemeFiles$),
					firstValueFrom(this.languageTokensFiles$),
				])

				const options = { recursive: true, pattern: "**/*.res" }

				const readDirectory = async function*(folder: string) {
					const entries = await fileSystem.readDirectory(folder, options)
					yield* entries.values().map(([path, type]) => <const>[posix.join(folder, path), type])
				}

				const entries = async function*() {
					yield* readDirectory("resource/ui")
					yield* readDirectory("scripts")
				}

				for await (const [path, type] of entries()) {
					if (type == 2 || clientSchemeFiles.has(path) || sourceSchemeFiles.has(path) || languageTokenFiles.has(path)) {
						continue
					}

					const entry = await firstValueFrom(fileSystem.resolve(path))
					if (entry.type == EntryType.File) {
						await using document = await documents.get(entry.uri)
						await firstValueFrom(document.definitionReferences$)
					}
				}
			})
		])
	}

	public fileType(uri: Uri) {
		const path = this.relative(uri)
		return combineLatest({
			clientScheme: this.clientSchemeFiles$,
			sourceScheme: this.sourceSchemeFiles$,
			chatScheme: this.chatSchemeFiles$,
			languageTokens: this.languageTokensFiles$,
			gameSounds: this.gameSoundsFiles$,
			surfaceProperties: this.sourceSchemeFiles$
		}).pipe(
			map((files) => VGUIWorkspace.getFileType(files, path)),
			distinctUntilChanged(),
			shareReplayUntilDisposed(this.dispose$),
		)
	}

	public getDefinitionReferences(path: string) {
		return this.fileSystem.resolve(path).pipe(
			switchMap((entry) => {
				if (entry.type != EntryType.File) {
					return of(null)
				}

				return usingAsync(async () => await this.documents.get(entry.uri)).pipe(
					switchMap((document) => {
						return document.definitionReferences$.pipe(
							map((definitionReferences) => ({ uri: entry.uri, definitions: definitionReferences.definitions }))
						)
					})
				)
			})
		)
	}

	public async setFileReferences(path: string, references: Map<string, References | null>) {
		const fileReferences = this.fileReferences.getOrInsertComputed(path, () => {
			const value = {
				references$: new BehaviorSubject(new Map()),
				document$: this.fileSystem.resolve(path).pipe(
					switchMap((entry) => entry.type == EntryType.File ? usingAsync(async () => await this.documents.get(entry.uri)) : of(null)),
					startWith(null),
					pairwise(),
					map(([previous, current]) => {
						if (previous) {
							previous.setDocumentReferences(new Map(references.keys().map((uri) => [uri, null])))
						}

						if (current) {
							current.setDocumentReferences(references)
						}

						return current
					})
				)
			}

			combineLatest({
				references: value.references$,
				document: value.document$,
			}).subscribe(({ references, document }) => {
				if (document) {
					document.setDocumentReferences(references)
				}
			})

			return value
		})

		for (const [uri, documentReferences] of references) {
			fileReferences.references$.value.set(uri, documentReferences)
		}

		fileReferences.references$.next(fileReferences.references$.value)
	}
}
