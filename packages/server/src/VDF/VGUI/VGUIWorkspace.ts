import { Uri } from "common/Uri"
import { posix } from "path"
import { BehaviorSubject, combineLatest, concatMap, distinctUntilChanged, firstValueFrom, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItemKind } from "vscode-languageserver"
import { DefinitionReferences, References } from "../../DefinitionReferences"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocuments } from "../../TextDocuments"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VDFTextDocumentSchema } from "../VDFTextDocument"
import { VGUITextDocument } from "./VGUITextDocument"

export const enum VGUIFileType {
	None = 0,
	ClientScheme = 1,
	SourceScheme = 2,
	LanguageTokens = 3,
}

export class VGUIWorkspace extends WorkspaceBase {

	public static readonly ClientSchemeSchema: VDFTextDocumentSchema = {
		keys: {},
		values: {
			backgroundtype: {
				kind: 13,
				values: [
					"0",
					"2",
				]
			},
			bordertype: {
				kind: 13,
				values: [
					"image",
					"scalable_image",
				]
			}
		},
		definitionReferences: [
			{
				type: Symbol.for("color"),
				definition: {
					directParentKeys: [
						"Scheme".toLowerCase(),
						"Colors".toLowerCase(),
					],
					children: false,
					key: null,
				},
				reference: {
					keys: new Set("color"),
					match: null
				},
				toCompletionItem: (definition) => {
					if (!definition.detail) {
						return undefined
					}

					try {
						const [r, g, b] = definition.detail.split(/\s+/).map(parseFloat)
						return { kind: CompletionItemKind.Color, documentation: `rgb(${r},${g},${b})` }
					}
					catch (_) {
						return undefined
					}
				},
			},
			{
				type: Symbol.for("color"),
				definition: {
					directParentKeys: [
						"Scheme".toLowerCase(),
						"BaseSettings".toLowerCase(),
					],
					children: false,
					key: null,
				},
				reference: {
					keys: new Set("color"),
					match: null
				},
				toCompletionItem: (definition) => {
					if (!definition.detail) {
						return undefined
					}

					try {
						const [r, g, b] = definition.detail.split(/\s+/).map(parseFloat)
						return { kind: CompletionItemKind.Color, documentation: `rgb(${r},${g},${b})` }
					}
					catch (_) {
						return undefined
					}
				},
			},
			{
				type: Symbol.for("border"),
				definition: {
					directParentKeys: [
						"Scheme".toLowerCase(),
						"Borders".toLowerCase(),
					],
					children: true,
					key: null,
				},
				reference: {
					keys: new Set(),
					match: null
				},
				toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
			},
			{
				type: Symbol.for("font"),
				definition: {
					directParentKeys: [
						"Scheme".toLowerCase(),
						"Fonts".toLowerCase(),
					],
					children: true,
					key: null,
				},
				reference: {
					keys: new Set(),
					match: null
				},
				toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
			}
		],
		files: [
			{
				name: "font file",
				parentKeys: [
					"Scheme".toLowerCase(),
					"CustomFontFiles".toLowerCase()
				],
				keys: new Set([
					"font",
				]),
				folder: null,
				resolve: (name) => name,
				extensionsPattern: ".*tf",
				displayExtensions: true
			},
			{
				name: "bitmap font file",
				parentKeys: [
					"Scheme".toLowerCase(),
					"BitmapFontFiles".toLowerCase()
				],
				keys: new Set([
					"Buttons".toLowerCase(),
					"ButtonsSC".toLowerCase(),
				]),
				folder: null,
				resolve: (name) => name,
				extensionsPattern: null,
				displayExtensions: true
			},
			{
				name: "image",
				parentKeys: [],
				keys: new Set([
					"image",
				]),
				folder: "materials/vgui",
				resolve: (name) => name.endsWith(".vmt") ? name : `${name}.vmt`,
				extensionsPattern: ".vmt",
				displayExtensions: false
			},
		],
		colours: {
			keys: {
				include: null,
				exclude: new Set(["inset"])
			},
			colours: [
				{
					pattern: /\d+\s+\d+\s+\d+\s+\d+/,
					parse(value) {
						const colour = value.split(/\s+/)
						return {
							red: parseInt(colour[0]) / 255,
							green: parseInt(colour[1]) / 255,
							blue: parseInt(colour[2]) / 255,
							alpha: parseInt(colour[3]) / 255
						}
					},
					stringify(colour) {
						return `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`
					},
				}
			]
		}
	}

	public static readonly SourceSchemeSchema: VDFTextDocumentSchema = {
		keys: {},
		values: {},
		definitionReferences: [],
		files: [],
		colours: {
			keys: null,
			colours: []
		}
	}

	public static readonly LanguageTokensSchema: VDFTextDocumentSchema = {
		keys: {},
		values: {},
		definitionReferences: [
			{
				type: Symbol.for("string"),
				definition: {
					directParentKeys: [
						"lang",
						"Tokens".toLowerCase()
					],
					children: false,
					key: null,
				},
				toReference: (value) => `#${value}`,
				toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, insertText: `#${definition.key}` })
			}
		],
		files: [],
		colours: {
			keys: null,
			colours: []
		}
	}

	private readonly subscriptions: { unsubscribe: () => void }[]
	private readonly fileSystem$: Observable<TeamFortress2FileSystem>
	private readonly documents: TextDocuments<VGUITextDocument>

	public readonly clientSchemeFiles$: Observable<Set<string>>
	public readonly clientScheme$: Observable<DefinitionReferences>

	public readonly sourceSchemeFiles$: Observable<Set<string>>

	public readonly languageTokensFiles$: Observable<Set<string>>
	public readonly languageTokens$: Observable<DefinitionReferences>

	public readonly clientSchemeReferences: Map<string, References>
	public readonly languageTokensReferences: Map<string, References>
	public readonly workspaceReferencesReady: Promise<void>

	private readonly documentSymbols: Map<string, Observable<VDFDocumentSymbols | null>>
	public readonly fileReferences: Map<string, { references: Map<string, References>, subject$: BehaviorSubject<References[]> }>

	constructor({
		uri,
		fileSystem$,
		documents,
		request
	}: {
		uri: Uri,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<VGUITextDocument>,
		request: Promise<void>,
	}) {
		super(uri)
		this.subscriptions = []
		this.fileSystem$ = fileSystem$
		this.documents = documents

		const files = (path: string): Observable<string[]> => {
			return fileSystem$.pipe(
				switchMap((fileSystem) => fileSystem.resolveFile(path)),
				concatMap(async (uri) => {
					return uri != null
						? await documents.get(uri, true)
						: null
				}),
				switchMap((document) => {
					if (!document) {
						return of([path])
					}

					return document.documentSymbols$.pipe(
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

		const definitions = (path: string): Observable<DefinitionReferences> => {
			return fileSystem$.pipe(
				switchMap((fileSystem) => fileSystem.resolveFile(path)),
				concatMap(async (uri) => {
					if (!uri) {
						throw new Error(path)
					}

					return await documents.get(uri, true)
				}),
				switchMap((document) => {
					return document.definitionReferences$
				}),
				shareReplay(1)
			)
		}

		this.clientSchemeFiles$ = files("resource/clientscheme.res").pipe(map((paths) => new Set(paths)), shareReplay(1))
		this.clientScheme$ = definitions("resource/clientscheme.res")

		// Preload clientscheme
		firstValueFrom(this.clientScheme$)

		// Preload hudanimations_manifest
		firstValueFrom(
			fileSystem$.pipe(
				switchMap((fileSystem) => {
					return fileSystem.resolveFile("scripts/hudanimations_manifest.txt").pipe(
						map((uri) => {
							if (uri) {
								documents.get(uri, true)
							}
						})
					)
				})
			)
		)

		this.sourceSchemeFiles$ = files("resource/sourcescheme.res").pipe(map((paths) => new Set(paths)), shareReplay(1))

		this.languageTokensFiles$ = combineLatest([files("resource/chat_english.txt"), files("resource/tf_english.txt")]).pipe(
			map((paths) => new Set(paths.flat())),
			shareReplay(1)
		)
		this.languageTokens$ = combineLatest([definitions("resource/chat_english.txt"), definitions("resource/tf_english.txt")]).pipe(
			map((dependencies) => {
				return dependencies.reduce(
					(result, definitionReferences) => {
						for (const definition of definitionReferences.definitions) {
							result.definitions.add(definition.type, definition.key, ...definition.value)
						}
						return result
					},
					new DefinitionReferences({ dependencies: dependencies })
				)
			}),
			shareReplay(1)
		)

		this.documentSymbols = new Map()
		this.fileReferences = new Map()

		this.clientSchemeReferences = new Map()
		this.languageTokensReferences = new Map()

		const { promise, resolve } = Promise.withResolvers<void>()
		this.workspaceReferencesReady = promise

		firstValueFrom(fileSystem$).then(async (fileSystem) => {
			const [clientSchemeFiles, sourceSchemeFiles, languageTokenFiles] = await Promise.all([
				firstValueFrom(this.clientSchemeFiles$),
				firstValueFrom(this.sourceSchemeFiles$),
				firstValueFrom(this.languageTokensFiles$),
			])

			const entries = await fileSystem.readDirectory("resource/ui", { recursive: true, pattern: "**/*.res" })

			const promises: Promise<void>[] = []

			for (const [name, type] of entries) {
				if (type == 2 || clientSchemeFiles.has(name) || sourceSchemeFiles.has(name) || languageTokenFiles.has(name)) {
					continue
				}

				const { promise, resolve } = Promise.withResolvers<void>()
				promises.push(promise)

				setTimeout(async () => {
					const uri = await firstValueFrom(fileSystem.resolveFile(name))
					if (uri) {
						await firstValueFrom((await documents.get(uri, true)).definitionReferences$)
					}
					resolve()
				}, 0)
			}

			await Promise.allSettled(promises)
			resolve()
		})
	}

	public fileType(uri: Uri) {
		const path = this.relative(uri)
		return combineLatest([this.clientSchemeFiles$, this.sourceSchemeFiles$, this.languageTokensFiles$]).pipe(
			map(([clientSchemeFiles, sourceSchemeFiles, languageTokensFiles]) => {
				if (clientSchemeFiles.has(path)) {
					return VGUIFileType.ClientScheme
				}
				else if (sourceSchemeFiles.has(path)) {
					return VGUIFileType.SourceScheme
				}
				else if (languageTokensFiles.has(path)) {
					return VGUIFileType.LanguageTokens
				}
				return VGUIFileType.None
			}),
			distinctUntilChanged(),
			shareReplay(1)
		)
	}

	public getVDFDocumentSymbols(path: string): Observable<VDFDocumentSymbols | null> {
		let documentSymbols$ = this.documentSymbols.get(path)
		if (!documentSymbols$) {
			documentSymbols$ = this.fileSystem$.pipe(
				switchMap((fileSystem) => fileSystem.resolveFile(path)),
				concatMap(async (uri) => {
					return uri
						? this.documents.get(uri, true)
						: null
				}),
				switchMap((document) => {
					return document != null
						? document.documentSymbols$
						: of(null)
				}),
				shareReplay(1)
			)
			this.documentSymbols.set(path, documentSymbols$)
		}
		return documentSymbols$
	}

	public getDefinitionReferences(path: string) {
		return this.fileSystem$.pipe(
			switchMap((fileSystem) => fileSystem.resolveFile(path)),
			concatMap(async (uri) => {
				return uri
					? this.documents.get(uri, true)
					: null
			}),
			switchMap((document) => {
				return document != null
					? document.definitionReferences$
					: of(null)
			}),
			shareReplay(1)
		)
	}

	public async setClientSchemeReferences(references: References[]) {
		for (const documentReferences of references) {
			this.clientSchemeReferences.set(documentReferences.uri.toString(), documentReferences)
		}

		const clientScheme = await firstValueFrom(this.clientScheme$)
		clientScheme.setDocumentReferences(references, true)
	}

	public async setLanguageTokensReferences(references: References[]) {
		for (const documentReferences of references) {
			this.languageTokensReferences.set(documentReferences.uri.toString(), documentReferences)
		}
	}

	private getFileReferencesValue(path: string) {
		let references$ = this.fileReferences.get(path)
		if (!references$) {
			const references = new Map<string, References>()
			references$ = { references: references, subject$: new BehaviorSubject(references.values().toArray()) }
			this.fileReferences.set(path, references$)
		}
		return references$
	}

	public getFileReferences(path: string) {
		return this.getFileReferencesValue(path).subject$
	}

	public async setFileReferences(path: string, references: References[]) {
		const fileReferences = this.getFileReferencesValue(path)
		for (const documentReferences of references) {
			fileReferences.references.set(documentReferences.uri.toString(), documentReferences)
		}
		fileReferences.subject$.next(fileReferences.references.values().toArray())
	}

	public dispose() {
		for (const subscription of this.subscriptions) {
			subscription.unsubscribe()
		}
	}
}
