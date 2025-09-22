import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, combineLatestWith, connectable, defer, distinctUntilChanged, finalize, firstValueFrom, map, Observable, of, ReplaySubject, shareReplay, Subscription, switchMap, type Connectable } from "rxjs"
import { VDFRange, type VDFParserOptions } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CodeActionKind, Color, ColorInformation, CompletionItem, CompletionItemKind, DiagnosticSeverity, DiagnosticTag, DocumentLink, InlayHint, TextEdit } from "vscode-languageserver"
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

export function resolveFileDetail<TDocument extends VDFTextDocument<TDocument>>(detail: string, configuration: VDFTextDocumentSchema<TDocument>["files"][number]) {
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
	dependencies$: Observable<VDFTextDocumentDependencies<TDocument>>
}

export interface VDFTextDocumentDependencies<TDocument extends VDFTextDocument<TDocument>> {
	schema: VDFTextDocumentSchema<TDocument>
	globals$: Observable<DefinitionReferences[]>
}

export interface VDFTextDocumentSchema<TDocument extends VDFTextDocument<TDocument>> {
	keys: Record<string, { distinct?: KeyDistinct, reference?: string[], values?: { label: string, kind: number, multiple?: boolean }[] }>
	values: Record<string, { kind: number, enumIndex?: boolean, values: string[], fix?: Record<string, string> }>
	getDefinitionReferences(params: DefinitionReferencesHandlerParams<TDocument>): { scopes: Map<symbol, Map<number, VDFRange>>, definitions: Collection<Definition>, references: Collection<VDFRange> }
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

export interface SchemaHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	document: TDocument
}

export interface DefinitionReferencesHandlerParams<TDocument extends VDFTextDocument<TDocument>> extends SchemaHandlerParams<TDocument> {
	documentSymbols: VDFDocumentSymbols
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

export abstract class VDFTextDocument<TDocument extends VDFTextDocument<TDocument>> extends TextDocumentBase<VDFDocumentSymbols, VDFTextDocumentDependencies<TDocument>> {

	public readonly configuration: VDFTextDocumentConfiguration<this>

	/**
	 * #base
	 */
	public readonly base$: Observable<string[]>
	public readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri; resolve: () => Promise<Uri | null> } })[]>
	public readonly colours$: Observable<(ColorInformation & { stringify(colour: Color): string })[]>
	public abstract readonly inlayHints$: Observable<InlayHint[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TDocument>,
		configuration: VDFTextDocument<TDocument>["configuration"],
	) {
		super(init, documentConfiguration$, fileSystem, {
			getDocumentSymbols: (text) => {
				return getVDFDocumentSymbols(text, configuration.VDFParserOptions)
			},
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			definitionReferences$: defer(() => this.documentSymbols$).pipe(
				combineLatestWith(configuration.dependencies$),
				map(([documentSymbols, dependencies]) => {
					const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children
					return {
						dependencies: dependencies,
						documentSymbols: documentSymbols,
						base: documentSymbols
							.values()
							.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
							.map((documentSymbol) => posix.resolve("/", configuration.relativeFolderPath ?? "", documentSymbol.detail!.replaceAll(/[/\\]+/g, "/")).substring(1))
							.toArray(),
						...dependencies.schema.getDefinitionReferences({
							document: this,
							documentSymbols: header ?? new VDFDocumentSymbols()
						})
					}
				}),
				(source$) => {

					function check(document: TDocument, stack: Uri[]): Observable<boolean> {
						const context = new Map<string, Observable<boolean>>()
						return document.base$.pipe(
							map((paths) => {
								const observables = paths.map((path) => {
									let observable$ = context.get(path)
									if (!observable$) {
										observable$ = fileSystem.resolveFile(path).pipe(
											switchMap((uri) => {
												if (uri == null) {
													return of(true)
												}
												else if (stack.some((u) => Uri.equals(u, uri)) || Uri.equals(uri, document.uri)) {
													return of(false)
												}
												else {
													return usingAsync(async () => await documents.get(uri)).pipe(
														switchMap((baseDocument) => check(baseDocument, [...stack, document.uri]))
													)
												}
											})
										)

										context.set(path, observable$)
									}

									return observable$
								})

								for (const path in context.keys().filter((path) => !paths.includes(path))) {
									context.delete(path)
								}

								return observables
							}),
							combineLatestPersistent(),
							map((results) => results.every((result) => result)),
							finalize(() => context.clear())
						)
					}

					const context = new Map<string, { connectable: Connectable<DefinitionReferences | null>, subscription: Subscription }>()

					return source$.pipe(
						switchMap((value) => {
							const observables = value.base.map((path) => {
								let value = context.get(path)
								if (!value) {
									const observable$ = connectable(
										fileSystem.resolveFile(path).pipe(
											switchMap((uri) => {
												if (uri == null) {
													return of(null)
												}
												else if (Uri.equals(uri, this.uri)) {
													return of(null)
												}
												else {
													return usingAsync(async () => await documents.get(uri)).pipe(
														switchMap((document) => {
															return check(document, [this.uri]).pipe(
																switchMap((result) => {
																	return result
																		? document.definitionReferences$
																		: of(null)
																}),
																finalize(() => {
																	document.setDocumentReferences(new Map<string, References | null>([[this.uri.toString(), null]]))
																})
															)
														})
													)
												}
											})
										),
										{
											connector: () => new ReplaySubject(1),
											resetOnDisconnect: false
										}
									)

									value = {
										connectable: observable$,
										subscription: observable$.connect()
									}

									context.set(path, value)
								}

								return value.connectable
							})

							for (const key of context.keys().filter((key) => !value.base.includes(key))) {
								context.get(key)!.subscription.unsubscribe()
								context.delete(key)
							}

							const base$ = defer(() => {
								if (observables.length != 0) {
									return combineLatest(observables).pipe(
										map((definitionReferences) => definitionReferences.filter((definitionReferences) => definitionReferences != null))
									)
								}
								else {
									return of([])
								}
							})

							return combineLatest({
								globals: value.dependencies.globals$,
								base: base$
							}).pipe(
								map(({ globals, base }) => {
									const definitions = value.definitions.clone()

									for (const baseDefinitionReferences of base) {
										for (const { scope, type, key, value: baseDefinitions } of baseDefinitionReferences.definitions) {
											// Copy #base definitions to document, used for Goto Definition
											definitions.set(null, type, key, ...baseDefinitions)
										}
									}

									for (const global of globals) {
										global.references.setDocumentReferences(this.uri, new References(this.uri, value.references, []), true)
									}

									return {
										dependencies: value.dependencies,
										documentSymbols: value.documentSymbols,
										definitionReferences: {
											scopes: value.scopes,
											definitions: new Definitions({
												collection: definitions,
												globals: globals.map(({ definitions }) => definitions)
											}),
											references: new References(this.uri, value.references, [], this.references$)
										} satisfies DefinitionReferences
									}
								}),
							)
						}),
						finalize(() => {
							for (const { subscription } of context.values()) {
								subscription.unsubscribe()
							}
							context.clear()
						})
					)
				}
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
													edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
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
												edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
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
											else if (Uri.equals(uri, this.uri)) {
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
																edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
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
													edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, relative))
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
											edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, newText))
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
													edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, newText))
												}
											},
										}
									})
								}

								if (definitions != null && definitions.some((definition) => Uri.equals(definition.uri, this.uri) && definition.range.contains(documentSymbol.detailRange!))) {
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
												edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, newPath))
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

		this.base$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols
					.values()
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
					.map((documentSymbol) => documentSymbol.detail!.replaceAll(/[/\\]+/g, "/"))
					.toArray()
			}),
			distinctUntilChanged((a: string[], b: string[]) => a.length == b.length && a.every((str, i) => str == b[i])),
			map((base) => base.map((value) => posix.resolve("/", this.configuration.relativeFolderPath ?? "", value).substring(1))),
			shareReplay(1)
		)

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
