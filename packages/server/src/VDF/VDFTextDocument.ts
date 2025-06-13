import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { finalizeWithValue } from "common/operators/finalizeWithValue"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatestWith, defer, distinctUntilChanged, finalize, firstValueFrom, map, Observable, of, ReplaySubject, shareReplay, Subject, switchMap } from "rxjs"
import { VDFRange, type VDFParserOptions } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CodeActionKind, Color, ColorInformation, CompletionItem, CompletionItemKind, DiagnosticSeverity, DiagnosticTag, DocumentLink, InlayHint } from "vscode-languageserver"
import { Collection, DefinitionReferences, Definitions, References, type Definition } from "../DefinitionReferences"
import type { DiagnosticCodeAction } from "../LanguageServer"
import { TextDocumentBase, type TextDocumentInit } from "../TextDocumentBase"

function ArrayContainsArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr2.length == 0) {
		return true
	}

	if (arr1.length < arr2.length) {
		return false
	}

	return arr1.some((_, index) => arr2.every((v, i) => index + i < arr1.length && comparer(arr1[index + i], v)))
}

export function resolveFileDetail(detail: string, configuration: VDFTextDocumentSchema["files"][number]) {
	const [basename, ...rest] = detail.replaceAll(/[/\\]+/g, "/").split("/").reverse()

	return posix.resolve(
		`/${configuration.folder}`,
		rest.reverse().join("/"),
		configuration.resolveBaseName(basename, (extension) => {
			return posix.extname(basename) == ""
				? basename + extension
				: basename
		})
	).substring(1)
}

export interface VDFTextDocumentConfiguration<TDocument extends VDFTextDocument<TDocument>> {
	relativeFolderPath: string | null
	VDFParserOptions: VDFParserOptions
	keyTransform: (key: string) => string,
	writeRoot: Uri | null
	dependencies$: Observable<VDFTextDocumentDependencies>
}

export interface VDFTextDocumentDependencies {
	schema: VDFTextDocumentSchema
	globals: DefinitionReferences[]
}

export interface VDFTextDocumentSchema {
	keys: Record<string, { distinct?: KeyDistinct, reference?: string[], values?: { label: string, kind: number, multiple?: boolean }[] }>
	values: Record<string, { kind: number, enumIndex?: boolean, values: string[], fix?: Record<string, string> }>
	definitionReferences: {
		type: symbol
		scope?: string
		definition: DefinitionMatcher | null
		reference?: {
			keys: Set<string>
			match: ((string: string) => boolean) | null
			toDefinition?: (string: string) => string
		},
		toReference?: (value: string) => string
		toCompletionItem?: (definition: Definition) => Partial<Omit<CompletionItem, "label">> | undefined
	}[]
	files: {
		name: string

		// Used for "font" links in ClientSchemeSchema
		parentKeys: string[]
		keys: Set<string>
		folder: string
		extensionsPattern: `.${string}` | null
		resolveBaseName: (value: string, withExtension: (extension: `.${string}`) => string) => string,
		toCompletionItem?: (name: string, type: number, withoutExtension: () => string) => Partial<Omit<CompletionItem, "kind">> | null,
		asset?: VGUIAssetType
	}[]
	colours: {
		keys: {
			include: Set<string> | null
			exclude: Set<string> | null
		} | null
		colours: {
			pattern: RegExp
			parse(value: string): Color
			stringify(colour: Color): string
		}[],
		completion?: {
			presets: CompletionItem[]
		}
	}
	completion: {
		root: CompletionItem[]
		typeKey: string | null
		defaultType: string | null
		values?: Record<string, { kind: CompletionItemKind, values: string[] }>
	}
}

export const enum KeyDistinct {
	None,
	First,
	Last,
}

export interface DefinitionMatcher {
	match(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]): DefinitionResult | void
}

export interface DefinitionResult {
	key: string
	keyRange: VDFRange
	nameRange?: VDFRange
}

export const enum VGUIAssetType {
	None = 0,
	Image = 1
}

export abstract class VDFTextDocument<TDocument extends VDFTextDocument<TDocument>> extends TextDocumentBase<VDFDocumentSymbols, VDFTextDocumentDependencies> {

	public readonly configuration: VDFTextDocumentConfiguration<TDocument>

	public readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri; resolve: () => Promise<Uri | null> } })[]>
	public readonly colours$: Observable<(ColorInformation & { stringify(colour: Color): string })[]>
	public abstract readonly inlayHints$: Observable<InlayHint[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TDocument>,
		configuration: VDFTextDocumentConfiguration<TDocument>,
	) {
		super(init, documentConfiguration$, fileSystem, {
			getDocumentSymbols: (text) => {
				return getVDFDocumentSymbols(text, configuration.VDFParserOptions)
			},
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			definitionReferences$: defer(() => this.documentSymbols$).pipe(
				combineLatestWith(configuration.dependencies$),
				(source) => defer(() => {

					const withContext = <T, TContext>(context: TContext) => {
						return (source: Observable<T>) => source.pipe(
							map((value) => <const>[value, context])
						)
					}

					const baseFiles = (relativeFolderPath: string | null) => {
						return (source: Observable<VDFDocumentSymbols>) => {
							return source.pipe(
								map((documentSymbols) => {
									return documentSymbols
										.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
										.map((documentSymbol) => documentSymbol.detail!.replaceAll(/[/\\]+/g, "/"))
								}),
								distinctUntilChanged((a, b) => a.length == b.length && a.every((v, i) => v == b[i])),
								map((values) => values.map((value) => fileSystem.resolveFile(posix.resolve("/", relativeFolderPath ?? "", value).substring(1)))),
								combineLatestPersistent(),
								map((uris) => uris.filter((uri) => uri != null)),
							)
						}
					}

					const check = (document: TDocument, stack: Uri[]): Observable<boolean> => {
						return document.documentSymbols$.pipe(
							baseFiles(document.configuration.relativeFolderPath),
							withContext(new Map<string, Observable<boolean>>()),
							finalizeWithValue(([_, context]) => context.clear()),
							map(([baseUris, context]) => {
								const observables = baseUris.map((baseUri) => {
									if (baseUri == null) {
										return of(true)
									}
									else if (baseUri.equals(document.uri) || stack.some((u) => baseUri.equals(u))) {
										return of(false)
									}
									else {
										const key = baseUri.toString()
										let observable = context.get(key)
										if (!observable) {
											observable = usingAsync(() => documents.get(baseUri)).pipe(
												switchMap((baseDocument) => {
													return check(baseDocument, [...stack, document.uri])
												})
											)
											context.set(key, observable)
										}
										return observable
									}
								})

								for (const key in context.keys().filter((key) => !baseUris.some((uri) => uri.toString() == key))) {
									context.delete(key)
								}

								return observables
							}),
							combineLatestPersistent(),
							map((results) => results.every((result) => result))
						)
					}

					const input = new Subject<VDFDocumentSymbols>()

					const observable = input.pipe(
						baseFiles(this.configuration.relativeFolderPath),
						withContext(new Map<string, Observable<DefinitionReferences | null>>()),
						map(([uris, context]) => {

							const observables = uris.map((uri) => {
								if (uri == null) {
									return of(null)
								}
								else if (uri.equals(this.uri)) {
									return of(null)
								}
								else {
									const key = uri.toString()
									let observable = context.get(key)
									if (!observable) {
										observable = usingAsync(() => documents.get(uri)).pipe(
											finalizeWithValue((document) => {
												document.setDocumentReferences(new Map<string, References | null>([[this.uri.toString(), null]]))
												context.delete(key)
											}),
											switchMap((document) => {
												return check(document, [this.uri]).pipe(
													switchMap((result) => {
														return result
															? document.definitionReferences$
															: of(null)
													})
												)
											})
										)
										context.set(key, observable)
									}
									return observable
								}
							})

							for (const key in context.keys().filter((key) => !uris.some((uri) => uri.toString() == key))) {
								context.delete(key)
							}

							return observables
						}),
						combineLatestPersistent(),
						map((definitionReferences) => {
							return definitionReferences.filter((definitionReferences) => definitionReferences != null)
						})
					)

					const output = new ReplaySubject<DefinitionReferences[]>(1)

					const subscription = observable.subscribe((value) => {
						output.next(value)
					})

					return source.pipe(
						switchMap(([documentSymbols, dependencies]) => {
							input.next(documentSymbols)
							return output.pipe(
								map((base) => {
									return {
										dependencies,
										documentSymbols,
										base
									}
								})
							)
						}),
						finalize(() => {
							input.complete()
							output.complete()
							subscription.unsubscribe()
						})
					)
				}),
				map(({ dependencies, documentSymbols, base }) => {

					const definitions = new Collection<Definition>()
					const references = new Collection<VDFRange>()

					const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children

					const scopes: Map<symbol, Map<number, VDFRange>> = new Map(
						dependencies.schema.definitionReferences
							.filter(({ scope }) => scope != undefined)
							.map(({ type, scope }) => [type, new Map(
								header
									?.values()
									.filter((documentSymbol) => documentSymbol.key.toLowerCase() == scope)
									.map((documentSymbol, index) => [index, documentSymbol.range])
							)])
					)

					documentSymbols.forAll((documentSymbol, path) => {
						const referenceKey = configuration.keyTransform(documentSymbol.key.toLowerCase())
						for (const { type, definition, reference } of dependencies.schema.definitionReferences) {

							const scope = scopes.get(type)?.entries().find(([scope, range]) => range.contains(documentSymbol.range))?.[0] ?? null

							if (definition) {
								const result = definition.match(documentSymbol, path,)
								if (result) {
									definitions.set(scope, type, result.key, {
										uri: this.uri,
										key: result.key,
										range: documentSymbol.range,
										keyRange: result.keyRange,
										nameRange: result.nameRange,
										detail: documentSymbol.detail
									})

									return
								}
							}

							if (reference && documentSymbol.detail != undefined && reference.keys.has(referenceKey) && (reference.match != null ? reference.match(documentSymbol.detail) : true)) {
								references.set(scope, type, reference.toDefinition ? reference.toDefinition(documentSymbol.detail) : documentSymbol.detail, documentSymbol.detailRange!)
							}
						}
					})

					for (const baseDefinitionReferences of base) {
						for (const { scope, type, key, value: baseDefinitions } of baseDefinitionReferences.definitions) {
							// Copy #base definitions to document, used for Goto Definition
							definitions.set(null, type, key, ...baseDefinitions)
						}
					}

					for (const global of dependencies.globals) {
						global.references.setDocumentReferences(this.uri, new References(this.uri, references, []), true)
					}

					return {
						dependencies: dependencies,
						documentSymbols: documentSymbols,
						definitionReferences: new DefinitionReferences(
							scopes,
							new Definitions({ collection: definitions, globals: dependencies.globals.map(({ definitions }) => definitions) }),
							new References(this.uri, references, base.map(({ references }) => references), this.references, this.references$)
						)
					}
				})
			),
			getDiagnostics: (dependencies, documentSymbols, definitionReferences) => {
				return documentSymbols.reduceRecursive(
					<(DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | null>)[]>[],
					(diagnostics, documentSymbol, path) => {
						if (documentSymbol.conditional != null && documentSymbol.conditional != "[]") {
							const conditional = documentSymbol.conditional.toLowerCase()
							if (TextDocumentBase.conditionals.values().map((c) => c.toLowerCase()).find((c) => c == conditional) == undefined) {
								return diagnostics
							}
						}

						const documentSymbolKey = configuration.keyTransform(documentSymbol.key.toLowerCase())

						// Distinct Keys
						if (documentSymbolKey in dependencies.schema.keys && dependencies.schema.keys[documentSymbolKey].distinct) {
							const distinct = dependencies.schema.keys[documentSymbolKey].distinct
							const parent = path.at(-1)
							if (parent?.children != undefined) {
								const find = distinct == KeyDistinct.First
									? Array.prototype.find
									: Array.prototype.findLast

								const first = find.call(parent.children, (i: VDFDocumentSymbol) => i.key.toLowerCase() == documentSymbol.key.toLowerCase() && i.conditional?.toLowerCase() == documentSymbol.conditional?.toLowerCase())!
								if (first != documentSymbol) {
									diagnostics.push({
										range: documentSymbol.nameRange,
										severity: DiagnosticSeverity.Warning,
										code: "duplicate-key",
										source: init.languageId,
										message: `Duplicate ${first.key}`,
										relatedInformation: [
											{
												location: {
													uri: this.uri.toString(),
													range: first.nameRange
												},
												message: `${first.key} is declared here.`
											}
										],
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit }) => {
												return {
													title: `Remove duplicate ${documentSymbol.key}`,
													edit: createDocumentWorkspaceEdit(documentSymbol.range, "")
												}
											}
										}
									})
								}
							}
						}

						if (documentSymbol.detail == undefined || documentSymbol.detailRange == undefined) {
							const diagnostic = this.validateDocumentSymbol(documentSymbol, path, documentSymbols, definitionReferences.definitions, definitionReferences.scopes)
							diagnostics.push(...Array.isArray(diagnostic) ? diagnostic : [diagnostic])
							return diagnostics
						}

						const documentSymbolValue = documentSymbol.detail.toLowerCase()

						// #base
						if (path.length == 0 && documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined) {
							if (documentSymbol.detail.trim() == "") {
								diagnostics.push({
									range: documentSymbol.range,
									severity: DiagnosticSeverity.Hint,
									source: init.languageId,
									message: "Unreachable code detected.",
									tags: [
										DiagnosticTag.Unnecessary
									],
									data: {
										kind: CodeActionKind.QuickFix,
										fix: ({ createDocumentWorkspaceEdit }) => {
											return {
												title: "Remove empty #base",
												edit: createDocumentWorkspaceEdit(documentSymbol.range, "")
											}
										},
									}
								})
							}
							else {
								const detail = documentSymbol.detail.replaceAll(/[/\\]+/g, "/")
								const dirname = this.uri.dirname()

								const relativePath = configuration.relativeFolderPath
									? posix.resolve(`/${configuration.relativeFolderPath}/${detail}`).substring(1)
									: dirname.relative(dirname.joinPath(detail))

								diagnostics.push(
									fileSystem.resolveFile(relativePath).pipe(
										map((uri): DiagnosticCodeAction | null => {
											if (uri == null) {
												return {
													range: documentSymbol.range,
													severity: DiagnosticSeverity.Hint,
													source: init.languageId,
													message: "Unreachable code detected.",
													tags: [
														DiagnosticTag.Unnecessary
													]
												}
											}
											else if (uri.equals(this.uri)) {
												return {
													range: documentSymbol.detailRange!,
													severity: DiagnosticSeverity.Error,
													code: "base-self-reference",
													source: init.languageId,
													message: "#base file references itself.",
													data: {
														kind: CodeActionKind.QuickFix,
														fix({ createDocumentWorkspaceEdit }) {
															return {
																title: "Remove #base",
																edit: createDocumentWorkspaceEdit(documentSymbol.range, "")
															}
														},
													}
												}
											}
											else {
												return null
											}
										})
									)
								)

								const baseUri = dirname.joinPath(detail)
								const relative = dirname.relative(baseUri)

								if (detail != relative) {
									diagnostics.push({
										range: documentSymbol.detailRange,
										severity: DiagnosticSeverity.Warning,
										code: "useless-path",
										source: init.languageId,
										message: `Unnecessary relative file path. (Expected "${relative}")`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit }) => {
												return {
													title: "Normalize file path",
													edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, relative)
												}
											},
										}
									})
								}
							}
						}

						// Static
						if (documentSymbolKey in dependencies.schema.values) {
							const valueData = dependencies.schema.values[documentSymbolKey]
							for (const [index, value] of valueData.values.entries()) {
								if (documentSymbolValue == value.toLowerCase() || (valueData.enumIndex && documentSymbolValue == index.toString())) {
									return diagnostics
								}
							}

							const values = !valueData.enumIndex
								? valueData.values
								: valueData.values.map((value, index) => [value, index]).flat()

							diagnostics.push({
								range: documentSymbol.detailRange,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-value",
								source: init.languageId,
								message: `'${documentSymbol.detail}' is not a valid value for ${documentSymbol.key}. Expected '${values.join("' | '")}'.`,
								data: {
									kind: CodeActionKind.QuickFix,
									fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {
										let newText: string | null = null

										const value = documentSymbol.detail!.toLowerCase()
										if (valueData.fix && value in valueData.fix) {
											newText = valueData.fix[value]
										}
										else {
											newText = findBestMatch(
												value,
												valueData.values
											)
										}

										if (!newText) {
											return null
										}

										return {
											title: `Change ${documentSymbol.key} to '${newText}'`,
											edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, newText)
										}
									}
								}
							})
						}

						// Dynamic
						if (documentSymbolValue != "") {
							const definitionReferencesConfiguration = dependencies
								.schema
								.definitionReferences
								.values()
								.filter((definitionReference): definitionReference is typeof definitionReference & { reference: NonNullable<typeof definitionReference["reference"]> } => definitionReference.reference != undefined)
								.find(({ reference: { keys, match: test } }) => keys.has(documentSymbolKey) && (test != null ? test(documentSymbolValue) : true))

							if (definitionReferencesConfiguration != undefined) {
								const scope = definitionReferences.scopes.get(definitionReferencesConfiguration.type)?.entries().find(([scope, range]) => range.contains(documentSymbol.range))?.[0] ?? null

								const detail = definitionReferencesConfiguration.reference.toDefinition
									? definitionReferencesConfiguration.reference.toDefinition(documentSymbol.detail)
									: documentSymbol.detail

								const definitions = definitionReferences.definitions.get(scope, definitionReferencesConfiguration.type, detail)

								if (!definitions || !definitions.length) {
									diagnostics.push({
										range: documentSymbol.detailRange,
										severity: DiagnosticSeverity.Warning,
										code: "invalid-reference",
										source: init.languageId,
										message: `Cannot find ${Symbol.keyFor(definitionReferencesConfiguration.type)} '${detail}'.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {

												let newText = findBestMatch(
													detail,
													definitionReferences
														.definitions
														.ofType(scope, definitionReferencesConfiguration.type)
														.values()
														.filter((definitions) => definitions.length)
														.map((definitions) => definitions[0].key)
														.toArray()
												)

												if (!newText) {
													return null
												}

												if (definitionReferencesConfiguration.toReference) {
													newText = definitionReferencesConfiguration.toReference(newText)
												}

												return {
													title: `Change ${documentSymbol.key} to '${newText}'`,
													edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, newText ?? "")
												}
											},
										}
									})
								}

								if (definitions != null && definitions.some((definition) => definition.uri.equals(this.uri) && definition.range.contains(documentSymbol.detailRange!))) {
									diagnostics.push({
										range: documentSymbol.detailRange,
										severity: DiagnosticSeverity.Warning,
										code: "self-reference",
										source: init.languageId,
										message: `${documentSymbol.key} '${documentSymbol.detail}' references itself.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: () => {
												return {
													title: `Remove ${documentSymbol.key}`,
													isPreferred: true,
													edit: {
														changes: {
															[this.uri.toString()]: [
																{
																	range: documentSymbol.range,
																	newText: ""
																}
															]
														}
													}
												}
											},
										}
									})
								}
							}
						}

						// Files
						const fileConfiguration = dependencies.schema.files.find(({ parentKeys, keys }) =>
							keys.has(documentSymbolKey) && ArrayContainsArray(path, parentKeys, (a, b) => a.key.toLowerCase() == b.toLowerCase())
						)

						if (fileConfiguration && documentSymbol.detail.trim() != "") {
							const path = resolveFileDetail(documentSymbol.detail, fileConfiguration)
							diagnostics.push(
								fileSystem.resolveFile(path).pipe(
									map((uri) => {
										return uri != null
											? null
											: {
												range: documentSymbol.detailRange!,
												severity: DiagnosticSeverity.Warning,
												code: "missing-file",
												source: init.languageId,
												message: `Cannot find ${fileConfiguration.name} '${documentSymbol.detail}'. (Resolved to "${path}")`,
											}
									})
								)
							)

							const detail = documentSymbol.detail.replaceAll(/[/\\]+/g, "/")

							let newPath: string
							if (fileConfiguration.folder) {
								newPath = posix.relative(
									`/${fileConfiguration.folder}`,
									posix.resolve(`/${fileConfiguration.folder}`, detail)
								)
							}
							else {
								newPath = posix.resolve(`/${detail}`).substring(1)
							}

							if (detail != newPath) {
								diagnostics.push({
									range: documentSymbol.detailRange!,
									severity: DiagnosticSeverity.Warning,
									code: "useless-path",
									source: init.languageId,
									message: `Unnecessary relative file path. Expected '${newPath}'`,
									data: {
										kind: CodeActionKind.QuickFix,
										fix: ({ createDocumentWorkspaceEdit }) => {
											return {
												title: "Normalize file path",
												edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, newPath)
											}
										},
									}
								})
							}
						}

						const diagnostic = this.validateDocumentSymbol(documentSymbol, path, documentSymbols, definitionReferences.definitions, definitionReferences.scopes)
						diagnostics.push(...Array.isArray(diagnostic) ? diagnostic : [diagnostic])
						return diagnostics
					}
				)
			},
		})

		this.configuration = configuration

		this.links$ = this.documentSymbols$.pipe(
			combineLatestWith(configuration.dependencies$),
			map(([documentSymbols, dependencies]) => {
				return documentSymbols.reduceRecursive(
					<(Omit<DocumentLink, "data"> & { data: { uri: Uri, resolve: () => Promise<Uri | null> } })[]>[],
					(links, documentSymbol, path) => {
						if (documentSymbol.children) {
							return links
						}

						let key = documentSymbol.key.toLowerCase()

						if (path.length == 0 && key == "#base") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									uri: this.uri,
									resolve: async () => {

										if (configuration.relativeFolderPath) {
											const relativePath = posix.resolve(`/${configuration.relativeFolderPath}`, documentSymbol.detail!).substring(1)

											const target = await firstValueFrom(fileSystem.resolveFile(relativePath))

											if (target) {
												return target
											}
										}

										const dirname = this.uri.dirname()
										return dirname.with({ path: posix.resolve(dirname.path, documentSymbol.detail!) })
									}
								}
							})
						}

						key = configuration.keyTransform(key)

						for (const fileConfiguration of dependencies.schema.files) {
							const { parentKeys, keys } = fileConfiguration
							if (keys.has(key) && ArrayContainsArray(path, parentKeys, (a, b) => a.key.toLowerCase() == b.toLowerCase()) && documentSymbol.detail != "") {
								links.push({
									range: documentSymbol.detailRange!,
									data: {
										uri: this.uri,
										resolve: async () => {
											const path = resolveFileDetail(documentSymbol.detail!, fileConfiguration)
											return await firstValueFrom(fileSystem.resolveFile(path)) ?? configuration.writeRoot?.joinPath(path) ?? null
										}
									}
								})
							}
						}

						return links
					}
				)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.colours$ = this.documentSymbols$.pipe(
			combineLatestWith(configuration.dependencies$),
			map(([documentSymbols, dependencies]) => {
				return documentSymbols.reduceRecursive(
					[] as (ColorInformation & { stringify(colour: Color): string })[],
					(colours, documentSymbol) => {

						if (!documentSymbol.detail) {
							return colours
						}

						if (dependencies.schema.colours.keys) {
							const key = configuration.keyTransform(documentSymbol.key.toLowerCase())

							const include = dependencies.schema.colours.keys.include != null
								? dependencies.schema.colours.keys.include.has(key)
								: true

							const exclude = dependencies.schema.colours.keys.exclude != null
								? dependencies.schema.colours.keys.exclude.has(key)
								: false

							if (!include || exclude) {
								return colours
							}
						}

						for (const { pattern, parse, stringify } of dependencies.schema.colours.colours) {
							if (pattern.test(documentSymbol.detail)) {
								colours.push({
									range: documentSymbol.detailRange!,
									color: parse(documentSymbol.detail),
									stringify: stringify,
								})
							}
						}

						return colours
					}
				)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)
	}

	protected abstract validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions, scopes: Map<symbol, Map<number | null, VDFRange>>): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null>
}
