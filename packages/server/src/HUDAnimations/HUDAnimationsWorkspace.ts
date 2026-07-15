import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { HUDAnimationsDocumentSymbols, HUDAnimationStatementType } from "hudanimations-documentsymbols"
import { BehaviorSubject, combineLatest, concat, firstValueFrom, ignoreElements, lastValueFrom, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import { Collection, Definitions, References, type Definition, type DefinitionReferences, type GlobalDefinitionReferences, type SetDocumentReferences } from "../DefinitionReferences"
import { WorkspaceBase } from "../WorkspaceBase"
import eventFiles from "./eventFiles.json"
import type { HUDAnimationsLanguageServer } from "./HUDAnimationsLanguageServer"
import { EventType, HUDAnimationsTextDocument } from "./HUDAnimationsTextDocument"

interface HUDAnimationsWorkspaceDocumentDependencies {
	document: HUDAnimationsTextDocument
	documentSymbols: HUDAnimationsDocumentSymbols
	definitions: Collection<Definition>
	references: Collection<VDFRange>
	eventNames: string[]
}

export class HUDAnimationsWorkspace extends WorkspaceBase {

	private readonly server: HUDAnimationsLanguageServer
	private readonly getDefinitions: (path: string) => Observable<{ uri: Uri, definitions: Definitions } | null>

	public readonly manifest$: Observable<HUDAnimationsTextDocument[]>
	public readonly clientScheme$: Observable<GlobalDefinitionReferences>
	public readonly files: Map<string, Observable<{ uris: Uri[], definitions: GlobalDefinitionReferences }> | null>
	public readonly definitionReferences$: Observable<{ documentSymbols: Map<string, HUDAnimationsDocumentSymbols>, definitionReferences: DefinitionReferences }>
	public readonly ready: Promise<void>

	constructor({
		uri,
		fileSystem,
		server,
		documents,
	}: {
		uri: Uri,
		fileSystem: FileSystemMountPoint,
		server: HUDAnimationsLanguageServer,
		documents: RefCountAsyncDisposableFactory<Uri, HUDAnimationsTextDocument>,
	}) {
		super(uri)
		this.server = server
		this.files = new Map()

		const ready$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.open, { uri }).pipe(
			ignoreElements()
		)

		const getVDFDocumentSymbols = (path: string) => concat(
			ready$,
			fromTRPCSubscription(server.trpc.servers.vgui.workspace.documentSymbol, { key: uri, path })
		)

		const fileDefinitions = new Map<string, Observable<{ uri: Uri, definitions: Definitions } | null>>()
		this.getDefinitions = (path: string) => {
			return fileDefinitions.getOrInsertComputed(path, () => {
				return concat(
					ready$,
					fromTRPCSubscription(server.trpc.servers.vgui.workspace.definitions, { key: uri, path: path })
				)
			})
		}

		this.manifest$ = getVDFDocumentSymbols("scripts/hudanimations_manifest.txt").pipe(
			map((documentSymbols) => {
				if (!documentSymbols) {
					return []
				}

				const hudanimations_manifest = documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children ?? []

				return hudanimations_manifest
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "file" && documentSymbol.detail != undefined)
					.map((documentSymbol) => documentSymbol.detail!)
			}),
			switchMap((files) => {
				if (!files.length) {
					console.warn(`hudanimations_manifest.length == 0`)
					return new BehaviorSubject([])
				}

				return combineLatest(
					files.map((file) => {
						return fileSystem.resolve(file).pipe(
							switchMap((entry) => {
								return entry.type == EntryType.File
									? usingAsync(async () => await documents.get(entry.uri))
									: of(null)
							}),
						)
					})
				)
			}),
			map((documents) => {
				return documents.filter((document) => document != null)
			}),
			shareReplay(1)
		)

		this.clientScheme$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.clientScheme, { key: uri }).pipe(
			map((definitions) => {
				return {
					definitions: definitions,
					references: {
						setDocumentReferences: (references, notify) => {
							const color = Symbol.for("color")
							const font = Symbol.for("font")

							const path = "resource/clientscheme.res"
							const workspaceFilesReferences = new Map<string, Map<string, Collection<VDFRange> | null>>()

							for (const [uri, fileReferences] of references) {
								if (fileReferences == null) {
									throw new Error("unreachable")
								}

								for (const { scope, type, key, value: ranges } of fileReferences!) {
									if (scope != null) {
										continue
									}

									if (type == color || type == font) {
										workspaceFilesReferences
											.getOrInsertComputed(path, () => new Map<string, Collection<VDFRange>>())
											.getOrInsertComputed(uri.toString(), () => new Collection<VDFRange>())!
											.set(null, type, key, ...ranges)
									}
								}

								workspaceFilesReferences.getOrInsertComputed("resource/clientscheme.res", () => new Map<string, null>([[uri, null]]))
							}

							this.setWorkspaceReferences(workspaceFilesReferences)
						},
					}
				} satisfies GlobalDefinitionReferences
			}),
			shareReplay(1)
		)

		this.definitionReferences$ = combineLatest({
			clientScheme: this.clientScheme$,
			manifest: this.manifest$.pipe(
				switchMap((documents) => {
					if (!documents.length) {
						return of({
							files: [],
							elements: [],
						})
					}

					return combineLatest(
						documents.map((document) => {
							return document.documentSymbols$.pipe(
								map((documentSymbols) => {
									return documentSymbols.reduce(
										(result, documentSymbol) => {
											result.definitions.set(null, EventType, documentSymbol.eventName, {
												uri: document.uri,
												key: documentSymbol.eventName,
												range: documentSymbol.range,
												documentation: document.definitions.documentation(documentSymbol),
												keyRange: documentSymbol.eventNameRange,
												conditional: documentSymbol.conditional?.value
											})

											const key = documentSymbol.eventName.toLowerCase()
											result.eventNames.push(key)

											const type = Symbol.for(key)

											for (const statement of documentSymbol.children) {
												if ("event" in statement) {
													result.references.set(null, EventType, statement.event, statement.eventRange)
												}

												if ("element" in statement) {
													result.references.set(null, type, statement.element, statement.elementRange)
												}

												if (statement.type == HUDAnimationStatementType.Animate) {
													if (HUDAnimationsTextDocument.colourProperties.has(statement.property.toLowerCase())) {
														result.references.set(null, Symbol.for("color"), statement.value, statement.valueRange)
													}
												}

												// HUDAnimationStatementType.SetFont
												if ("font" in statement) {
													result.references.set(null, Symbol.for("font"), statement.font, statement.fontRange)
												}
											}

											return result
										},
										{
											document: document,
											documentSymbols: documentSymbols,
											definitions: new Collection<Definition>(),
											references: new Collection<VDFRange>(),
											eventNames: [],
										} as HUDAnimationsWorkspaceDocumentDependencies
									)
								})
							)
						})
					).pipe(
						switchMap((files) => {
							const eventNames = new Set(files.flatMap((file) => file.eventNames))
							return (
								eventNames.size != 0
									? combineLatest(eventNames.values().map((eventName) => this.getEventDefinitions(eventName)?.pipe(map((value) => ({ name: eventName, elements: value })))).filter((observable) => observable != null).toArray())
									: of([])
							).pipe(
								map((elements) => {
									return {
										files: files,
										elements,
									}
								})
							)
						})
					)
				})
			),
		}).pipe(
			map(({ manifest: { files, elements }, clientScheme }) => {
				const color = Symbol.for("color")
				const font = Symbol.for("font")
				const element = Symbol.for("element")

				const definitions = new Collection<Definition>()
				const workspaceFilesReferences = new Map<string, Map<string, Collection<VDFRange> | null>>()

				workspaceFilesReferences.set("resource/clientscheme.res", new Map())

				for (const event in eventFiles) {
					// @ts-ignore
					const eventFile: string | string[] = eventFiles[event]
					for (const path of typeof eventFile == "string" ? [eventFile] : eventFile) {
						workspaceFilesReferences.getOrInsertComputed(path, () => new Map<string, Collection<VDFRange>>())
					}
				}

				for (const file of files) {
					for (const { type, key, value } of file.definitions) {
						definitions.set(null, type, key, ...value)
					}

					for (const { scope, type, key, value: ranges } of file.references) {
						if (scope != null) {
							continue
						}

						let target: { paths: string[], type: symbol } | null

						if (type == color || type == font) {
							target = { paths: ["resource/clientscheme.res"], type: type }
						}
						else {
							const key = Symbol.keyFor(type)!
							if (((key): key is keyof typeof eventFiles => key in eventFiles)(key)) {
								const eventFile = eventFiles[key]
								target = { paths: typeof eventFile == "string" ? [eventFile] : eventFile, type: element }
							}
							else {
								target = null
							}
						}

						if (target == null) {
							continue
						}

						for (const path of target.paths) {
							workspaceFilesReferences
								.get(path)!
								.getOrInsertComputed(file.document.uri.toString(), () => new Collection<VDFRange>())!
								.set(null, target.type, key, ...ranges)
						}

						workspaceFilesReferences.getOrInsertComputed("resource/clientscheme.res", () => new Map<string, null>([[file.document.uri.toString(), null]]))

						for (const event in eventFiles) {
							// @ts-ignore
							const eventFile: string | string[] = eventFiles[event]
							for (const path of typeof eventFile == "string" ? [eventFile] : eventFile) {
								workspaceFilesReferences
									.get(path)!
									.getOrInsertComputed(file.document.uri.toString(), () => null)
							}
						}
					}
				}

				const definitionReferences = {
					scopes: new Map(),
					definitions: new Definitions({
						version: files.map((file) => file.document.version),
						collection: definitions,
						globals: [
							clientScheme,
							...elements.map(({ elements: { definitions } }) => definitions),
						]
					}),
					references: new References(
						this.uri,
						undefined,
						[],
						new BehaviorSubject(new Map<string, References>(files.map((file) => <const>[file.document.uri.toString(), new References(file.document.uri, file.references, [])])))
					)
				} satisfies DefinitionReferences

				this.setWorkspaceReferences(workspaceFilesReferences)

				return {
					definitionReferences: definitionReferences,
					documentSymbols: new Map(files.map(({ document, documentSymbols }) => [document.uri.toString(), documentSymbols]))
				}
			}),
			shareReplay(1)
		)

		this.ready = Promise.all([firstValueFrom(ready$), firstValueFrom(this.definitionReferences$)]).then(() => undefined)
	}

	public getEventDefinitions(event: string) {
		return this.files.getOrInsertComputed(event, () => {
			// @ts-ignore
			const eventFile: string | string[] | undefined = eventFiles[event]
			if (!eventFile) {
				return null
			}

			const paths = typeof eventFile == "string" ? [eventFile] : eventFile
			return combineLatest(
				paths.map((path) => this.getDefinitions(path))
			).pipe(
				map((documents) => documents.filter((document) => document != null)),
				map((documents) => {
					return {
						uris: documents.map((document) => document.uri),
						definitions: {
							definitions: new Definitions({
								version: documents.flatMap((document) => document.definitions.version),
								collection: documents.reduce(
									(collection, document) => {
										for (const { key, value } of document.definitions) {
											collection.set(null, Symbol.for(event), key, ...value)
										}
										return collection
									},
									new Collection<Definition>()
								)
							}),
							references: {
								setDocumentReferences: (references, notify) => {
									throw new Error("unreachable")
								},
							} satisfies SetDocumentReferences
						}
					}
				}),
				shareReplay(1)
			)
		})
	}

	public setWorkspaceReferences(workspaceFilesReferences: Map<string, Map<string, Collection<VDFRange> | null>>) {
		this.server.trpc.servers.vgui.workspace.setFilesReferences.mutate({
			key: this.uri,
			references: new Map(
				workspaceFilesReferences
					.entries()
					.map(([path, pathReferences]) => [path, new Map(pathReferences.entries().map(([uri, collection]) => [uri, collection != null ? new References(new Uri(uri), collection, []) : null]))])
			)
		})
	}
}
