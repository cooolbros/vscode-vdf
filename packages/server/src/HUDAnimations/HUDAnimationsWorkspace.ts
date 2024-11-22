import type { Uri } from "common/Uri"
import { HUDAnimationsDocumentSymbols, HUDAnimationStatementType } from "hudanimations-documentsymbols"
import { BehaviorSubject, combineLatest, concatMap, firstValueFrom, from, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { DefinitionReferences, Definitions, References } from "../DefinitionReferences"
import type { TeamFortress2FileSystem } from "../TeamFortress2FileSystem"
import type { TextDocuments } from "../TextDocuments"
import { WorkspaceBase } from "../WorkspaceBase"
import eventFiles from "./eventFiles.json"
import { EventType, HUDAnimationsTextDocument } from "./HUDAnimationsTextDocument"

interface HUDAnimationsWorkspaceDocumentDependencies {
	document: HUDAnimationsTextDocument
	documentSymbols: HUDAnimationsDocumentSymbols
	definitions: Definitions
	references: References
	eventNames: string[]
	sounds: Record<string, Observable<Uri | null>>
}

export class HUDAnimationsWorkspace extends WorkspaceBase {

	private readonly fileSystem$: Observable<TeamFortress2FileSystem>
	private readonly getVDFDocumentSymbols: (path: string) => Promise<Observable<VDFDocumentSymbols | null>>
	private readonly getDefinitions: (path: string) => Promise<Observable<DefinitionReferences["definitions"] | null>>

	public readonly manifest$: Observable<HUDAnimationsTextDocument[]>
	public readonly clientScheme$: Observable<DefinitionReferences["definitions"]>
	public readonly files: Map<string, Observable<{ uris: Uri[], definitions: Definitions }> | null>
	public readonly definitionReferences$: Observable<{ documentSymbols: Map<HUDAnimationsTextDocument, HUDAnimationsDocumentSymbols>, definitionReferences: DefinitionReferences }>
	public readonly ready: Promise<void>

	constructor({
		uri,
		fileSystem$,
		documents,
		request,
		getVDFDocumentSymbols,
		getDefinitions,
		setClientSchemeReferences,
		setFileReferences,
	}: {
		uri: Uri
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<HUDAnimationsTextDocument>,
		request: Promise<void>,
		getVDFDocumentSymbols: (path: string) => Promise<Observable<VDFDocumentSymbols | null>>,
		getDefinitions: (path: string) => Promise<Observable<DefinitionReferences["definitions"] | null>>,
		setClientSchemeReferences: (references: References[]) => Promise<void>,
		setFileReferences: (references: Map<string, References[]>) => Promise<void>,
	}) {
		super(uri)
		this.fileSystem$ = fileSystem$
		this.files = new Map()
		this.getVDFDocumentSymbols = async (path) => {
			await request
			return await getVDFDocumentSymbols(path)
		}

		const fileDefinitions = new Map<string, Promise<Observable<DefinitionReferences["definitions"] | null>>>()
		this.getDefinitions = (path: string) => {
			let definitions = fileDefinitions.get(path)
			if (!definitions) {
				definitions = getDefinitions(path)
				fileDefinitions.set(path, definitions)
			}
			return definitions
		}

		this.manifest$ = from(this.getVDFDocumentSymbols("scripts/hudanimations_manifest.txt")).pipe(
			switchMap((observable) => observable),
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
						return this.fileSystem$.pipe(
							switchMap((fileSystem) => fileSystem.resolveFile(file)),
							concatMap(async (uri) => {
								return uri != null
									? await documents.get(uri, true)
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

		this.clientScheme$ = from(this.getDefinitions("resource/clientscheme.res")).pipe(
			switchMap((observable) => observable),
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
											result.definitions.add(EventType, documentSymbol.eventName, {
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
													result.references.addReference(EventType, statement.event, statement.eventRange)
												}

												if ("element" in statement) {
													result.references.addReference(type, statement.element, statement.elementRange)
												}

												if (statement.type == HUDAnimationStatementType.Animate) {
													if (HUDAnimationsTextDocument.colourProperties.has(statement.property.toLowerCase())) {
														result.references.addReference(Symbol.for("color"), statement.value, statement.valueRange)
													}
												}

												// HUDAnimationStatementType.SetFont
												if ("font" in statement) {
													result.references.addReference(Symbol.for("font"), statement.font, statement.fontRange)
												}

												if ("sound" in statement) {
													const path = `sound/${statement.sound.replaceAll(/[/\\]+/g, "/")}`
													result.sounds[statement.sound] = fileSystem$.pipe(
														switchMap((fileSystem) => fileSystem.resolveFile(path))
													)
												}
											}

											return result
										},
										{
											document: document,
											documentSymbols: documentSymbols,
											definitions: new Definitions(),
											references: new References(document.uri),
											eventNames: <string[]>[],
											sounds: <Record<string, Observable<Uri | null>>>{}
										} satisfies HUDAnimationsWorkspaceDocumentDependencies
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
				const definitionReferences = new DefinitionReferences({
					globals: [
						clientScheme,
						...elements.map(({ elements: { definitions } }) => definitions),
					]
				})

				for (const { definitions, references } of files) {
					for (const [key, value] of definitions.ofType(EventType)) {
						definitionReferences.definitions.add(EventType, key, ...value)
					}

					definitionReferences.setDocumentReferences([references], false)
				}

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
				Promise.all(manifest.map(async (document) => this.extractWorkspaceReferences(document.uri, await firstValueFrom(document.definitionReferences$))))
			])

			const clientSchemeReferences: References[] = []
			const filesReferences = new Map<string, References[]>()

			for (const references of documentsReferences) {
				clientSchemeReferences.push(references.workspaceClientSchemeReferences)
				for (const [path, fileReferences] of references.workspaceFilesReferences) {
					let pathReferences = filesReferences.get(path)
					if (!pathReferences) {
						pathReferences = []
						filesReferences.set(path, pathReferences)
					}
					pathReferences.push(fileReferences)
				}
			}

			await Promise.all([
				setClientSchemeReferences(clientSchemeReferences),
				setFileReferences(filesReferences)
			])
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

						const uri$ = this.fileSystem$.pipe(
							switchMap((fileSystem) => fileSystem.resolveFile(path)),
							shareReplay(1)
						)

						const definitions$ = from(this.getDefinitions(path)).pipe(shareReplay(1))
						// firstValueFrom(definitions$)

						return uri$.pipe(
							switchMap((uri) => {
								return definitions$.pipe(
									switchMap((observable) => observable),
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
							definitions: files.reduce(
								(definitions, file) => {
									for (const { key, value } of file.definitions) {
										definitions.add(Symbol.for(event), key, ...value)
									}
									return definitions
								},
								new Definitions()
							)
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

	public extractWorkspaceReferences(uri: Uri, definitionReferences: DefinitionReferences) {

		const workspaceClientSchemeReferences = new References(uri)
		const workspaceFilesReferences = new Map<string, References>()

		for (const { type, key, value: ranges } of definitionReferences.references.get(uri.toString()) ?? []) {
			const path = Symbol.keyFor(type)!

			// @ts-ignore
			const eventFile: string | string[] | undefined = eventFiles[path]
			if (eventFile) {
				for (const file of typeof eventFile == "string" ? [eventFile] : eventFile) {

					let references = workspaceFilesReferences.get(file)
					if (!references) {
						references = new References(uri)
						workspaceFilesReferences.set(file, references)
					}

					for (const range of ranges) {
						references.addReference(Symbol.for("element"), key, range)
					}
				}
			}

			if (type == Symbol.for("color") || type == Symbol.for("font")) {
				for (const range of ranges) {
					workspaceClientSchemeReferences.addReference(type, key, range)
				}
			}
		}

		return {
			workspaceClientSchemeReferences,
			workspaceFilesReferences,
		}
	}
}
