import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, concatMap, defer, firstValueFrom, from, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import type { VDFParserOptions, VDFRange } from "vdf"
import { getVDFDocumentSymbols, VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, Color, ColorInformation, CompletionItem, DiagnosticSeverity, DiagnosticTag, DocumentLink } from "vscode-languageserver"
import { DefinitionReferences, Definitions, References, type Definition } from "../DefinitionReferences"
import type { DiagnosticCodeAction } from "../LanguageServer"
import type { TeamFortress2FileSystem } from "../TeamFortress2FileSystem"
import { TextDocumentBase, type TextDocumentInit } from "../TextDocumentBase"
import type { TextDocuments } from "../TextDocuments"

function ArrayContainsArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr2.length == 0) {
		return true
	}

	if (arr1.length < arr2.length) {
		return false
	}

	return arr1.some((_, index) => arr2.every((v, i) => index + i < arr1.length && comparer(arr1[index + i], v)))
}

function ArrayEndsWithArray<T1, T2>(arr1: T1[], arr2: T2[], comparer: (a: T1, b: T2) => boolean): boolean {

	if (arr1.length < arr2.length) {
		return false
	}

	const start = arr1.length - arr2.length
	return arr2.every((value, index) => comparer(arr1[start + index], value))
}

export interface VDFTextDocumentConfiguration<TDocument extends VDFTextDocument<TDocument, TDependencies>, TDependencies> {
	relativeFolderPath: string | null
	VDFParserOptions: VDFParserOptions
	keyTransform: (key: string) => string,
	dependencies$: Observable<VDFTextDocumentDependencies>
	getCodeLens(definitionReferences$: Observable<DefinitionReferences>): Observable<DefinitionReferences>
}

export interface VDFTextDocumentDependencies {
	schema: VDFTextDocumentSchema
	global: DefinitionReferences[]
}

export interface VDFTextDocumentSchema {
	keys: Record<string, { distinct?: boolean, reference?: string[], values?: { label: string, kind: number, multiple?: boolean }[] }>
	values: Record<string, { kind: number, enumIndex?: boolean, values: string[], fix?: Record<string, string> }>
	definitionReferences: {
		type: symbol
		definition: {
			directParentKeys: string[]
			children: boolean
			key: {
				/**
				 * @example "fieldName"
				 * @example "name"
				 */
				name: string,
				/**
				 * Whether to override documentSymbol.key
				 */
				priority: boolean
			} | null
		} | null
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
		folder: string | null
		resolve: (name: string) => string
		extensionsPattern: `.${string}` | null
		displayExtensions: boolean
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
		}[]
	}
}

export abstract class VDFTextDocument<TDocument extends VDFTextDocument<TDocument, TDependencies>, TDependencies> extends TextDocumentBase<VDFDocumentSymbols, VDFTextDocumentDependencies> {

	public readonly configuration: VDFTextDocumentConfiguration<TDocument, TDependencies>

	public readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri; resolve: () => Promise<Uri | null> } })[]>
	public readonly colours$: Observable<(ColorInformation & { stringify(colour: Color): string })[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<TDocument>,
		configuration: VDFTextDocumentConfiguration<TDocument, TDependencies>,
	) {
		super(init, documentConfiguration$, fileSystem$, {
			getDocumentSymbols: (text) => {
				return getVDFDocumentSymbols(text, configuration.VDFParserOptions)
			},
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			definitionReferences$: combineLatest({ dependencies: configuration.dependencies$, documentSymbols: defer(() => this.documentSymbols$) }).pipe(
				switchMap(({ dependencies, documentSymbols }) => {
					const base = documentSymbols
						.filter((documentSymbol) => documentSymbol.key == "#base" && documentSymbol.detail != undefined)
						.map((documentSymbol) => {
							const value = documentSymbol.detail!.replaceAll(/[/\\]+/g, "/")
							return (
								configuration.relativeFolderPath
									? fileSystem$.pipe(switchMap((fileSystem) => fileSystem.resolveFile(posix.resolve(`/${configuration.relativeFolderPath}`, value).substring(1))))
									: of(this.uri.dirname().joinPath(value))
							).pipe(
								switchMap((uri) => {
									if (uri == null || uri.equals(this.uri)) {
										return of(null)
									}

									return from(documents.get(uri, true)).pipe(
										switchMap((baseDocument) => {
											function check(document: TDocument, stack: Uri[]): Observable<boolean> {
												return document.documentSymbols$.pipe(
													map((documentSymbols) => {
														return documentSymbols
															.filter((documentSymbol) => documentSymbol.key == "#base" && documentSymbol.detail != undefined)
															.map((documentSymbol) => {
																const value = documentSymbol.detail!.replaceAll(/[/\\]+/g, "/")
																return (
																	document.configuration.relativeFolderPath
																		? fileSystem$.pipe(switchMap((fileSystem) => fileSystem.resolveFile(posix.resolve(`/${baseDocument.configuration.relativeFolderPath}`, value).substring(1))))
																		: of(baseDocument.uri.dirname().joinPath(value))
																).pipe(
																	switchMap((baseUri) => {
																		if (!baseUri) {
																			return of(true)
																		}
																		else if (stack.some((uri) => uri.equals(baseUri))) {
																			return of(false)
																		}
																		else {
																			return from(documents.get(baseUri, true)).pipe(
																				switchMap((baseDocument) => {
																					return check(baseDocument, [...stack, document.uri])
																				})
																			)
																		}
																	})
																)
															})
													}),
													switchMap((base) => {
														return base.length != 0
															? combineLatest(base).pipe(map((results) => results.every((result) => result)))
															: of(true)
													})
												)
											}

											return check(baseDocument, [init.uri, baseDocument.uri]).pipe(
												switchMap((result) => {
													return result
														? baseDocument.definitionReferences$
														: of(null)
												})
											)
										})
									)
								})
							)
						})

					const base$ = base.length != 0
						? combineLatest(base).pipe(map((dependencies) => dependencies.filter((definitionReferences) => definitionReferences != null)))
						: of([])

					return base$.pipe(
						map((base) => {
							const definitionReferences = new DefinitionReferences({
								dependencies: [
									...base,

									// Add document references to workspace
									...dependencies.global
								],
								globals: dependencies.global.map((definitionReferences) => definitionReferences.definitions)
							})

							const references = new References(this.uri)

							documentSymbols.forAll((documentSymbol, path) => {
								const referenceKey = configuration.keyTransform(documentSymbol.key.toLowerCase())
								for (const { type, definition, reference } of dependencies.schema.definitionReferences) {

									if (definition) {

										let key: string | undefined, keyRange: VDFRange | undefined, nameRange: VDFRange | undefined

										if (definition.key != null) {
											const keyDocumentSymbol = documentSymbol.children?.find((i) => i.key.toLowerCase() == definition.key!.name && i.detail != undefined)
											if (keyDocumentSymbol) {
												if (definition.key.priority) {
													key = keyDocumentSymbol.detail!
													keyRange = keyDocumentSymbol.detailRange!
													nameRange = undefined
												}
												else {
													key = documentSymbol.key
													keyRange = documentSymbol.nameRange
													nameRange = keyDocumentSymbol.detailRange!
												}
											}
											else {
												key = undefined
												keyRange = undefined
												nameRange = undefined
											}
										}
										else {
											key = documentSymbol.key
											keyRange = documentSymbol.nameRange
											nameRange = undefined
										}

										if (key && keyRange && ArrayEndsWithArray(path, definition.directParentKeys, (a, b,) => a.key.toLowerCase() == b.toLowerCase()) && ((definition.children ? documentSymbol.children : documentSymbol.detail) != undefined)) {
											definitionReferences.definitions.add(type, key, {
												uri: this.uri,
												key: key,
												range: documentSymbol.range,
												keyRange: keyRange,
												nameRange: nameRange,
												detail: documentSymbol.detail
											})
										}
									}

									if (reference && documentSymbol.detail != undefined && reference.keys.has(referenceKey) && (reference.match != null ? reference.match(documentSymbol.detail) : true)) {
										references.addReference(type, reference.toDefinition ? reference.toDefinition(documentSymbol.detail) : documentSymbol.detail, documentSymbol.detailRange!)
									}
								}
							})

							for (const baseDefinitionReferences of base) {
								for (const { type, key, value: baseDefinitions } of baseDefinitionReferences.definitions) {
									// Add #base definitions to document, used for Goto Definition
									definitionReferences.definitions.add(type, key, ...baseDefinitions)
								}
							}

							// Add references to document, used for Find References and Code Lens
							definitionReferences.setDocumentReferences([references], false)

							return definitionReferences
						}),
						map((definitionReferences) => {
							return {
								dependencies: dependencies,
								documentSymbols: documentSymbols,
								definitionReferences: definitionReferences
							}
						})
					)
				})
			),
			getDiagnostics: (dependencies, documentSymbols, definitionReferences) => {
				return documentSymbols.reduceRecursive(
					<(DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | null>)[]>[],
					(diagnostics, documentSymbol, path) => {
						if (documentSymbol.detail == undefined || documentSymbol.detailRange == undefined) {
							const diagnostic = this.validateDocumentSymbol(documentSymbol, path, documentSymbols, definitionReferences.definitions)
							diagnostics.push(...Array.isArray(diagnostic) ? diagnostic : [diagnostic])
							return diagnostics
						}

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
										fix: (createDocumentWorkspaceEdit) => {
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
									: dirname.relative(dirname.joinPath(detail)).path.substring(1)

								diagnostics.push(
									fileSystem$.pipe(
										switchMap((fileSystem) => fileSystem.resolveFile(relativePath)),
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
														fix(createDocumentWorkspaceEdit, findBestMatch) {
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
								const relative = dirname.relative(baseUri).path.substring(1)

								if (detail != relative) {
									diagnostics.push({
										range: documentSymbol.detailRange,
										severity: DiagnosticSeverity.Warning,
										code: "useless-path",
										source: init.languageId,
										message: `Unnecessary relative file path. (Expected "${relative}")`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: (createDocumentWorkspaceEdit) => {
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

						const documentSymbolKey = configuration.keyTransform(documentSymbol.key.toLowerCase())
						const documentSymbolValue = documentSymbol.detail.toLowerCase()

						// Distinct Keys
						if (documentSymbolKey in dependencies.schema.keys && dependencies.schema.keys[documentSymbolKey].distinct == true) {
							const parent = path.at(-1)
							if (parent?.children != undefined) {
								const first = parent.children.find((i) => configuration.keyTransform(i.key.toLowerCase()) == documentSymbolKey && i.conditional?.toLowerCase() == documentSymbol.conditional?.toLowerCase())!
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
											fix: (createDocumentWorkspaceEdit) => {
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
									fix: (createDocumentWorkspaceEdit, findBestMatch) => {
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
								const detail = definitionReferencesConfiguration.reference.toDefinition
									? definitionReferencesConfiguration.reference.toDefinition(documentSymbol.detail)
									: documentSymbol.detail

								const definitions = definitionReferences.definitions.get(definitionReferencesConfiguration.type, detail)

								if (!definitions || !definitions.length) {
									diagnostics.push({
										range: documentSymbol.detailRange,
										severity: DiagnosticSeverity.Warning,
										code: "invalid-reference",
										source: init.languageId,
										message: `Cannot find ${Symbol.keyFor(definitionReferencesConfiguration.type)} '${detail}'.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: (createDocumentWorkspaceEdit, findBestMatch) => {

												let newText = findBestMatch(
													detail,
													definitionReferences
														.definitions
														.ofType(definitionReferencesConfiguration.type)
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

						if (fileConfiguration && documentSymbol.detail != "") {
							const detail = documentSymbol.detail.replaceAll(/[/\\]+/g, "/")

							let path: string
							if (fileConfiguration.folder) {
								const [basename, ...rest] = detail.split("/").reverse()
								path = posix.resolve(`/${fileConfiguration.folder}/${rest.reverse().join("/")}/${fileConfiguration.resolve(basename)}`).substring(1)
							}
							else {
								path = posix.resolve("/", detail).substring(1)
							}

							diagnostics.push(
								fileSystem$.pipe(
									switchMap((fileSystem) => fileSystem.resolveFile(path)),
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

							let newPath: string
							if (fileConfiguration.folder) {
								newPath = posix.relative(fileConfiguration.folder, posix.resolve(`/${fileConfiguration.folder}`, detail).substring(1))
							}
							else {
								newPath = posix.resolve("/", detail).substring(1)
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
										fix: (createDocumentWorkspaceEdit) => {
											return {
												title: "Normalize file path",
												edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, newPath)
											}
										},
									}
								})
							}
						}

						const diagnostic = this.validateDocumentSymbol(documentSymbol, path, documentSymbols, definitionReferences.definitions)
						diagnostics.push(...Array.isArray(diagnostic) ? diagnostic : [diagnostic])
						return diagnostics
					}
				)
			},
			getCodeLens: (definitionReferences$: Observable<DefinitionReferences>) => {
				return configuration.getCodeLens(definitionReferences$)
			}
		})

		this.configuration = configuration

		this.links$ = combineLatest({ documentSymbols: this.documentSymbols$, dependencies: configuration.dependencies$ }).pipe(
			map(({ documentSymbols, dependencies }) => {
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

											const target = await firstValueFrom(
												fileSystem$.pipe(
													switchMap((fileSystem) => fileSystem.resolveFile(relativePath))
												)
											)

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

						for (const { parentKeys, keys, folder, resolve } of dependencies.schema.files) {
							if (keys.has(key) && ArrayContainsArray(path, parentKeys, (a, b) => a.key.toLowerCase() == b.toLowerCase()) && documentSymbol.detail != "") {
								links.push({
									range: documentSymbol.detailRange!,
									data: {
										uri: this.uri,
										resolve: async () => {
											const path = posix.resolve(folder ? `/${folder}` : "/", resolve(documentSymbol.detail!.replace(/[/\\]+/, "/"))).substring(1)
											return await firstValueFrom(
												fileSystem$.pipe(
													switchMap((fileSystem) => {
														return fileSystem.resolveFile(path).pipe(
															concatMap(async (uri) => {
																if (uri) {
																	return uri
																}
																return fileSystem.paths[0].joinPath(path)
															})
														)
													})
												)
											)
										}
									}
								})
							}
						}

						return links
					}
				)
			}),
			shareReplay(1)
		)

		this.colours$ = combineLatest([this.documentSymbols$, configuration.dependencies$]).pipe(
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
			shareReplay(1),
		)
	}

	protected abstract validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null>
}
