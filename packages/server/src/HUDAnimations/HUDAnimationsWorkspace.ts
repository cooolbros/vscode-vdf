import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { HUDAnimationsDocumentSymbols, HUDAnimationStatementType } from "hudanimations-documentsymbols"
import { BehaviorSubject, combineLatest, concat, concatMap, firstValueFrom, from, ignoreElements, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { Collection, DefinitionReferences, Definitions, References, type Definition } from "../DefinitionReferences"
import { WorkspaceBase } from "../WorkspaceBase"
import eventFiles from "./eventFiles.json"
import { EventType, HUDAnimationsTextDocument } from "./HUDAnimationsTextDocument"

interface HUDAnimationsWorkspaceDocumentDependencies {
	document: HUDAnimationsTextDocument
	documentSymbols: HUDAnimationsDocumentSymbols
	definitions: Collection<Definition>
	references: Collection<VDFRange>
	eventNames: string[]
}

export class HUDAnimationsWorkspace extends WorkspaceBase {

	private readonly fileSystem: FileSystemMountPoint
	private readonly getVDFDocumentSymbols: (path: string) => Observable<VDFDocumentSymbols | null>
	private readonly getDefinitions: (path: string) => Observable<DefinitionReferences["definitions"] | null>

	public readonly manifest$: Observable<HUDAnimationsTextDocument[]>
	public readonly clientScheme$: Observable<DefinitionReferences["definitions"]>
	public readonly files: Map<string, Observable<{ uris: Uri[], definitions: Definitions }> | null>
	public readonly definitionReferences$: Observable<{ documentSymbols: Map<HUDAnimationsTextDocument, HUDAnimationsDocumentSymbols>, definitionReferences: DefinitionReferences }>
	public readonly ready: Promise<void>

	constructor({
		uri,
		fileSystem,
		documents,
		request,
		getVDFDocumentSymbols,
		getDefinitions,
		setFileReferences,
	}: {
		uri: Uri
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, HUDAnimationsTextDocument>,
		request: Promise<void>,
		getVDFDocumentSymbols: (path: string) => Observable<VDFDocumentSymbols | null>,
		getDefinitions: (path: string) => Observable<DefinitionReferences["definitions"] | null>,
		setFileReferences: (references: Map<string /* path */, Map<string /* Uri */, References | null>>) => Promise<void>,
	}) {
		super(uri)
		this.fileSystem = fileSystem
		this.files = new Map()

		const ready$ = from(request).pipe(ignoreElements())

		this.getVDFDocumentSymbols = (path) => concat(ready$, getVDFDocumentSymbols(path))

		const fileDefinitions = new Map<string, Observable<DefinitionReferences["definitions"] | null>>()
		this.getDefinitions = (path: string) => {
			let definitions = fileDefinitions.get(path)
			if (!definitions) {
				definitions = concat(ready$, getDefinitions(path))
				fileDefinitions.set(path, definitions)
			}
			return definitions
		}

		this.manifest$ = this.getVDFDocumentSymbols("scripts/hudanimations_manifest.txt").pipe(
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
						return fileSystem.resolveFile(file).pipe(
							concatMap(async (uri) => {
								return uri != null
									? await documents.get(uri)
									: null
							})
						)
					})
				)
			}),
			map((documents) => {
				return documents.filter((document) => document != null)
			}),
			shareReplay(1)
		)

		this.clientScheme$ = this.getDefinitions("resource/clientscheme.res").pipe(
			map((definitions) => definitions!),
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

				const definitions = new Collection<Definition>()

				for (const file of files) {
					for (const { type, key, value } of file.definitions) {
						definitions.set(null, type, key, ...value)
					}
				}

				const definitionReferences = new DefinitionReferences(
					new Map(),
					new Definitions({
						collection: definitions,
						globals: [
							clientScheme,
							...elements.map(({ elements: { definitions } }) => definitions),
						]
					}),
					new References(
						this.uri,
						undefined,
						[],
						new Map<string, References>(
							files.map((file) => <const>[file.document.uri.toString(), new References(file.document.uri, file.references, [])])
						)
					)
				)

				return {
					definitionReferences: definitionReferences,
					documentSymbols: new Map(files.map(({ document, documentSymbols }) => [document, documentSymbols]))
				}
			}),
			shareReplay(1)
		)

		this.ready = firstValueFrom(this.manifest$).then(async (manifest) => {
			const [_, documentsReferences] = await Promise.all([
				request,
				Promise.all(manifest.map(async (document) => HUDAnimationsWorkspace.extractWorkspaceReferences(document.uri, (await firstValueFrom(document.definitionReferences$)).references)))
			])

			const paths = documentsReferences.values().flatMap((map) => map.keys())

			await setFileReferences(
				new Map(
					paths.map((path) => {
						return [
							path,
							new Map(
								documentsReferences
									.values()
									.map((map) => map.get(path))
									.filter((map) => map != null)
									.flatMap((map) => map.entries())
							)
						]
					})
				)
			)
		})
	}

	public getEventDefinitions(event: string) {

		let definitions$ = this.files.get(event)

		// null = no definitions
		if (definitions$ === undefined) {

			// @ts-ignore
			const eventFile: string | string[] | undefined = eventFiles[event]
			if (eventFile) {
				const paths = typeof eventFile == "string" ? [eventFile] : eventFile
				definitions$ = combineLatest(
					paths.map((path) => {

						const uri$ = this.fileSystem.resolveFile(path).pipe(
							shareReplay(1)
						)

						const definitions$ = from(this.getDefinitions(path)).pipe(shareReplay(1))

						return uri$.pipe(
							switchMap((uri) => {
								return definitions$.pipe(
									map((definitions) => {
										return { uri, definitions }
									})
								)
							})
						)
					})
				).pipe(
					map((files) => files.filter((file): file is { [P in keyof typeof file as P]: NonNullable<typeof file[P]> } => file.uri != null && file.definitions != null)),
					map((files) => {
						return {
							uris: files.map((file) => file.uri),
							definitions: new Definitions({
								collection: files.reduce(
									(collection, file) => {
										for (const { key, value } of file.definitions) {
											collection.set(null, Symbol.for(event), key, ...value)
										}
										return collection
									},
									new Collection<Definition>()
								)
							})
						}
					}),
					shareReplay(1)
				)
			}
			else {
				definitions$ = null
			}

			this.files.set(event, definitions$)
		}

		return definitions$
	}

	public static extractWorkspaceReferences(uri: Uri, references: References) {

		const workspaceFilesReferences = new Map<string, Map<string, Collection<VDFRange>>>()

		const iterator = (function*() {
			yield* Iterator.from(references).map(s => ({ uri: uri, ...s }))
			for (const documentReferences of references.rest.values()) {
				yield* Iterator.from(documentReferences).map(s => ({ uri: documentReferences.uri, ...s }))
			}
		})()

		for (const { uri, type, key, value: ranges } of iterator) {

			let target: { paths: string[], type: symbol } | null

			if (type == Symbol.for("color") || type == Symbol.for("font")) {
				target = {
					paths: ["resource/clientscheme.res"],
					type: type
				}
			}
			else {
				const key = Symbol.keyFor(type)!
				if (key in eventFiles) {
					// @ts-ignore
					const eventFile: string | string[] = eventFiles[key]!
					target = {
						paths: typeof eventFile == "string" ? [eventFile] : eventFile,
						type: Symbol.for("element")
					}
				}
				else {
					target = null
				}
			}

			if (!target) {
				continue
			}

			for (const path of target.paths) {
				let pathReferences = workspaceFilesReferences.get(path)
				if (!pathReferences) {
					pathReferences = new Map<string, Collection<VDFRange>>()
					workspaceFilesReferences.set(path, pathReferences)
				}

				let uriReferences = pathReferences.get(uri.toString())
				if (!uriReferences) {
					uriReferences = new Collection<VDFRange>()
					pathReferences.set(uri.toString(), uriReferences)
				}

				uriReferences.set(null, target.type, key, ...ranges)
			}
		}

		return new Map(
			workspaceFilesReferences.entries().map(([path, pathReferences]) => {
				return [
					path,
					new Map(pathReferences.entries().map(([uri, collection]) => {
						return [
							uri,
							new References(new Uri(uri), collection, [])
						]
					}))
				]
			})
		)
	}
}
