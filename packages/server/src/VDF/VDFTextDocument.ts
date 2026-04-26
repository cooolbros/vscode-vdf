import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { BaseErrorType, BaseResultType, combineLatestBaseFiles, type BaseError, type BaseResult, type BaseValue } from "common/operators/combineLatestBaseFiles"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { catchError, combineLatest, concat, distinctUntilChanged, filter, finalize, firstValueFrom, map, NEVER, Observable, of, shareReplay, startWith, switchMap } from "rxjs"
import { VDFPosition, VDFRange, type VDFParserOptions } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CompletionItem, DiagnosticSeverity, DiagnosticTag, InlayHint, TextEdit } from "vscode-languageserver"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "../DefinitionReferences"
import type { CompletionFiles } from "../LanguageServer"
import { TextDocumentBase, type ColourInformationStringify, type DiagnosticCodeAction, type DiagnosticCodeActions, type DocumentLinkData, type TextDocumentInit } from "../TextDocumentBase"

export interface VDFTextDocumentConfiguration<TDependencies extends VDFTextDocumentDependencies> {
	relativeFolderPath: string | null
	VDFParserOptions: VDFParserOptions
	keyTransform: (key: string) => string,
	dependencies$: Observable<TDependencies>
}

export interface VDFTextDocumentDependencies {
	schema: VDFTextDocumentSchema<this>
	globals$: Observable<DefinitionReferences[]>
}

export interface VDFTextDocumentSchema<TDependencies extends VDFTextDocumentDependencies> {
	keys: Record<string, { reference?: string[], values?: { label: string, kind: number, multiple?: boolean }[] }>
	values: Record<string, { kind: number, enumIndex?: boolean, values: string[], fix?: Record<string, string> }>
	getDefinitionReferences(params: DefinitionReferencesHandlerParams<TDependencies>): { scopes: Map<symbol, Map<number, VDFRange>>, definitions: Collection<Definition>, references: Collection<VDFRange> }
	definitionReferences: Map<symbol, { keys: Set<string>, toReference?: ((name: string) => string) }>
	getDiagnostics(params: DiagnosticsHandlerParams<TDependencies>): DiagnosticCodeActions
	getLinks(params: DocumentLinksHandlerParams): DocumentLinkData[]
	getColours(params: DocumentColoursHandlerParams): ColourInformationStringify[]
	getInlayHints(params: DocumentInlayHintsHandlerParams<TDependencies>): Promise<InlayHint[]>
	completion: {
		root: CompletionItem[]
		typeKey: string | null
		defaultType: string | null
		files: {
			keys: Set<string>
			folder: string | null
			extensionsPattern: `.${string}` | null
			toCompletionItem?: (name: string, type: number, withoutExtension: () => string) => Partial<Omit<CompletionItem, "kind">> | null,
			asset?: VGUIAssetType
		}[]
		values?: Record<string, CompletionItem[] | ((args: { text?: string, position: VDFPosition, files: CompletionFiles }) => Promise<CompletionItem[]>)>
	}
}

export interface DefinitionReferencesHandlerParams<TDependencies extends VDFTextDocumentDependencies> {
	dependencies: TDependencies
	documentSymbols: VDFDocumentSymbols
}

export interface DiagnosticsHandlerParams<TDependencies extends VDFTextDocumentDependencies> {
	dependencies: TDependencies
	documentConfiguration: VSCodeVDFConfiguration
	documentSymbols: VDFDocumentSymbol[]
	definitionReferences: DefinitionReferences
}

export interface DocumentLinksHandlerParams {
	documentSymbols: VDFDocumentSymbol[]
	definitionReferences: DefinitionReferences
	resolve: (value: string, extension?: `.${string}`) => string
}

export interface DocumentColoursHandlerParams {
	documentSymbols: VDFDocumentSymbol[]
	next: (callback: (colours: ColourInformationStringify[], documentSymbol: VDFDocumentSymbol) => void) => ColourInformationStringify[]
}

export interface DocumentInlayHintsHandlerParams<TDependencies extends VDFTextDocumentDependencies> {
	dependencies: TDependencies
	documentSymbols: VDFDocumentSymbol[]
}

export const enum VGUIAssetType {
	None = 0,
	Image = 1
}

export interface Context<TDependencies extends VDFTextDocumentDependencies> {
	dependencies: TDependencies,
	documentConfiguration: VSCodeVDFConfiguration,
	documentSymbols: VDFDocumentSymbols | undefined,
	definitionReferences: DefinitionReferences,
}

export type Validate<TDependencies extends VDFTextDocumentDependencies> = (name: string, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDependencies>) => DiagnosticCodeActions

export const enum KeyDistinct {
	None,
	First,
	Last,
}

export type RefineString<TDependencies extends VDFTextDocumentDependencies> = (name: string, detail: string, detailRange: VDFRange, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDependencies>) => DiagnosticCodeActions

export type RefineReference<TDependencies extends VDFTextDocumentDependencies> = (...args: [...Parameters<RefineString<TDependencies>>, definitions: readonly Definition[]]) => DiagnosticCodeActions

export type Fallback<TDependencies extends VDFTextDocumentDependencies> = (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDependencies>, unknown: () => DiagnosticCodeActions) => DiagnosticCodeActions

export abstract class VDFTextDocument<
	TDocument extends VDFTextDocument<TDocument, TDependencies>,
	TDependencies extends VDFTextDocumentDependencies
> extends TextDocumentBase<VDFDocumentSymbols, TDependencies> {

	private static base(documentSymbols: VDFDocumentSymbols): string[] {
		return documentSymbols
			.values()
			.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
			.map((documentSymbol) => documentSymbol.detail!.replaceAll(/[/\\]+/g, "/"))
			.toArray()
	}

	public readonly configuration: VDFTextDocumentConfiguration<TDependencies>

	protected getDiagnostics: (dependencies: TDependencies, configuration: VSCodeVDFConfiguration, documentSymbols: VDFDocumentSymbols, definitionReferences: DefinitionReferences) => DiagnosticCodeActions

	/**
	 * #base
	 */
	public readonly base$: Observable<string[]>

	private readonly context = new Map<string, Observable<BaseResult<DefinitionReferences>>>()

	public readonly diagnostics = {
		unreachable: (range: VDFRange, fix?: NonNullable<DiagnosticCodeAction["data"]>["fix"]): DiagnosticCodeAction => {
			return {
				range: range,
				severity: DiagnosticSeverity.Hint,
				message: "Unreachable code detected.",
				tags: [
					DiagnosticTag.Unnecessary
				],
				...(fix && {
					data: {
						fix: fix
					}
				})
			}
		},
		any: () => [],
		header: (validate: Validate<TDependencies>, multiple: boolean): VDFTextDocumentSchema<TDependencies>["getDiagnostics"] => {
			return ({ dependencies, documentConfiguration, documentSymbols, definitionReferences }) => {
				const diagnostics: DiagnosticCodeActions = []
				const [header, ...rest] = documentSymbols
				if (header != undefined) {
					diagnostics.push(
						...validate(
							header.key,
							header,
							[],
							{
								dependencies: dependencies,
								documentConfiguration: documentConfiguration,
								documentSymbols: header.children,
								definitionReferences: definitionReferences,
							}
						)
					)
				}

				if (!multiple) {
					diagnostics.push(...rest.map((documentSymbol) => this.diagnostics.unreachable(documentSymbol.range)))
				}

				return diagnostics
			}
		},
		documentSymbols: (distinct: KeyDistinct, unknown: (key: string, parent: string, documentSymbol: VDFDocumentSymbol, context: Context<TDependencies>) => DiagnosticCodeActions = (key, parent, documentSymbol) => [{ range: documentSymbol.nameRange, severity: DiagnosticSeverity.Warning, code: "unknown-key", source: this.languageId, message: `Unknown key '${key}'.` }]) => {

			const finds = {
				[KeyDistinct.First]: Array.prototype.find,
				[KeyDistinct.Last]: Array.prototype.findLast,
			}

			return (schema: Record<string, [Validate<TDependencies>] | [Validate<TDependencies>, KeyDistinct]>, fallback?: Fallback<TDependencies>): Validate<TDependencies> => {
				const map = new Map(Object.entries(schema).map(([key, [validate, d = distinct]]) => [key.toLowerCase(), { key, validate, distinct: d }]))
				return (name, documentSymbol, path, context) => {
					const diagnostics: DiagnosticCodeActions = []
					const parent = documentSymbol
					if (parent.children == undefined) {
						diagnostics.push({
							range: documentSymbol.detailRange!,
							severity: DiagnosticSeverity.Warning,
							code: "invalid-type",
							source: this.languageId,
							message: `Invalid ${name} type.`,
						})
					}
					else {
						parent.children.forEach((documentSymbol) => {
							if (documentSymbol.conditional != null && documentSymbol.conditional.length > "[$]".length) {
								const conditional = documentSymbol.conditional.toLowerCase()
								if (TextDocumentBase.conditionals.values().map((c) => c.toLowerCase()).find((c) => c == conditional) == undefined) {
									return
								}
							}

							const data = map.get(documentSymbol.key.toLowerCase())
							if (data == undefined) {
								diagnostics.push(
									...fallback?.(documentSymbol, [...path, parent], context, () => unknown(documentSymbol.key, name, documentSymbol, context))
									?? unknown(documentSymbol.key, name, documentSymbol, context)
								)
							}
							else {

								// Distinct Keys
								if (data.distinct != undefined && data.distinct != KeyDistinct.None) {
									const first = finds[data.distinct].call(parent.children, (i: VDFDocumentSymbol) => i.key.toLowerCase() == documentSymbol.key.toLowerCase() && i.conditional?.toLowerCase() == documentSymbol.conditional?.toLowerCase())!
									if (first != documentSymbol) {
										diagnostics.push({
											range: documentSymbol.nameRange,
											severity: DiagnosticSeverity.Warning,
											code: "duplicate-key",
											source: this.languageId,
											message: `Duplicate key '${first.key}'`,
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

								diagnostics.push(TextDocumentBase.diagnostics.key(data.key, documentSymbol.key, documentSymbol.nameRange))
								diagnostics.push(...data.validate(data.key, documentSymbol, [...path, parent], context))
							}
						})
					}
					return diagnostics
				}
			}
		},
		string: (refine?: RefineString<TDependencies>): Validate<TDependencies> => {
			return (key, documentSymbol, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				if (documentSymbol.detail == undefined) {
					diagnostics.push({
						range: documentSymbol.childrenRange!,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: this.languageId,
						message: `Invalid ${key} type.`,
					})
				}
				else {
					diagnostics.push(...refine?.(key, documentSymbol.detail, documentSymbol.detailRange!, documentSymbol, path, context) ?? [])
				}

				return diagnostics
			}
		},
		length: (max: number): RefineString<TDependencies> => {
			return (name, detail, detailRange, path, context) => {
				const length = detail.length + "\0".length
				if (length > max) {
					return [{
						range: detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-length",
						source: this.languageId,
						message: `Value exceeds maximum buffer size (max: ${max}, size: ${length}).`,
					}]
				}
				return []
			}
		},
		integer: ((name, detail, detailRange, path, context) => {
			if (/\D/.test(detail)) {
				return [{
					range: detailRange,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-integer",
					source: this.languageId,
					message: `Invalid value for ${name}. Expected integer`,
				}]
			}
			return []
		}) satisfies RefineString<TDependencies>,
		float: ((name, detail, detailRange, path, context) => {
			if (!/^\d*\.?\d+$/.test(detail)) {
				return [{
					range: detailRange,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-float",
					source: this.languageId,
					message: `Invalid value for ${name}. Expected float`,
				}]
			}
			return []
		}) satisfies RefineString<TDependencies>,
		set: (values: string[], fix?: Record<string, string>): RefineString<TDependencies> => {
			const set = new Set(values.map((value) => value.toLowerCase()))
			return (name, detail, detailRange, path, context) => {
				if (!set.has(detail.toLowerCase())) {
					return [{
						range: detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-value",
						source: this.languageId,
						message: `'${detail}' is not a valid value for ${name}. Expected '${values.join("' | '")}'.`,
						data: {
							fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {
								const value = detail.toLowerCase()
								const newText = fix != undefined && value in fix
									? fix[value]
									: findBestMatch(value, values)

								if (!newText) {
									return null
								}

								return {
									title: `Change ${name} to '${newText}'`,
									edit: createDocumentWorkspaceEdit(TextEdit.replace(detailRange, newText))
								}
							},
						}
					}]
				}
				else {
					const value = values.find((value) => value.toLowerCase() == detail!.toLowerCase())!
					return [TextDocumentBase.diagnostics.key(value, detail, detailRange)]
				}
			}
		},
		dynamic: (key: string): RefineString<TDependencies> => {
			const id = key.toLowerCase()
			return (name, detail, detailRange, documentSymbol, path, context) => {
				if (id in context.dependencies.schema.values) {
					const values = context.dependencies.schema.values[id].values
					if (!values.some((value) => value.toLowerCase() == detail.toLowerCase())) {
						return [{
							range: detailRange,
							severity: DiagnosticSeverity.Warning,
							code: "invalid-value",
							source: this.languageId,
							message: `'${detail}' is not a valid value for ${name}. Expected '${values.join("' | '")}'.`,
						}]
					}
				}
				return []
			}
		},
		reference: (type: symbol, refine?: RefineReference<TDependencies>): RefineString<TDependencies> => {
			return (key, detail, detailRange, documentSymbol, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				if (detail == "") {
					return diagnostics
				}

				const scope = context.definitionReferences.scopes.get(type)?.entries().find(([scope, range]) => range.contains(detailRange))?.[0] ?? null
				const definitions = context.definitionReferences.definitions.get(scope, type, detail)

				if (!definitions || !definitions.length) {
					diagnostics.push({
						range: detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-reference",
						source: this.languageId,
						message: `Cannot find ${Symbol.keyFor(type)} '${detail}'.`,
						data: {
							fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {

								const newText = findBestMatch(
									detail,
									context.definitionReferences
										.definitions
										.ofType(scope, type)
										.values()
										.filter((definitions) => definitions.length)
										.map((definitions) => definitions[0].key)
										.toArray()
								)

								if (!newText) {
									return null
								}

								return {
									title: `Change ${key} to '${newText}'`,
									edit: createDocumentWorkspaceEdit(TextEdit.replace(detailRange, newText))
								}
							},
						}
					})

				}
				else {
					if (definitions.some((definition) => Uri.equals(definition.uri, this.uri) && definition.range.contains(detailRange))) {
						diagnostics.push({
							range: detailRange,
							severity: DiagnosticSeverity.Warning,
							code: "self-reference",
							source: this.languageId,
							message: `${key} '${detail}' references itself.`,
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: `Remove ${key}`,
										isPreferred: true,
										edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
									}
								},
							}
						})
					}

					diagnostics.push(TextDocumentBase.diagnostics.key(definitions[0].key, detail, detailRange, { newText: (name) => context.dependencies.schema.definitionReferences.get(type)?.toReference?.(name) ?? name }))
					diagnostics.push(...refine?.(key, detail, detailRange, documentSymbol, path, context, definitions) ?? [])
				}

				return diagnostics
			}
		},
		file: (name: string, folder: string | null, extension: string | null): RefineString<TDependencies> => {
			return (_name, detail, detailRange, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				if (detail == "") {
					return diagnostics
				}

				const value = detail.replaceAll(/[/\\]+/g, "/")

				const newPath = folder != null
					? posix.relative(`/${folder}`, posix.resolve(`/${folder}/${value}`))
					: posix.resolve(`/${value}`).substring(1)

				if (value != newPath) {
					diagnostics.push({
						range: detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "useless-path",
						source: this.languageId,
						message: `Unnecessary relative file path. Expected '${newPath}'`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Normalize file path",
									edit: createDocumentWorkspaceEdit(TextEdit.replace(detailRange, newPath))
								}
							},
						}
					})
				}

				const file = posix.resolve(`/${folder ?? ""}/${extension != undefined && posix.extname(value) == "" ? `${value}${extension}` : value}`).substring(1)

				diagnostics.push(
					this.fileSystem.resolveFile(file).pipe(
						map((uri) => {
							if (uri != null) {
								return null
							}

							return {
								range: detailRange,
								severity: DiagnosticSeverity.Warning,
								code: "missing-file",
								source: this.languageId,
								message: `Cannot find ${name} '${detail}'. (Resolved to "${file}")`,
							}
						})
					)
				)

				return diagnostics
			}
		},
		next: (schema: Record<string, RefineString<TDependencies>>): Validate<TDependencies> => {
			const map = new Map(Object.entries(schema).map(([key, validate]) => <const>[key.toLowerCase(), { key, validate }]))
			return (key, documentSymbol, path, context) => {
				const data = map.get(key)
				return data != undefined && documentSymbol.detail != undefined
					? data.validate(data.key, documentSymbol.detail, documentSymbol.detailRange!, documentSymbol, path, context)
					: []
			}
		}
	}

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		createFileSystemWatcher: (uri: Uri) => Observable<"change" | "create" | "delete">,
		documents: RefCountAsyncDisposableFactory<Uri, TDocument>,
		configuration: VDFTextDocumentConfiguration<TDependencies>,
	) {
		super(init, documentConfiguration$, fileSystem, {
			getDocumentSymbols: (text) => {
				return getVDFDocumentSymbols(text, configuration.VDFParserOptions)
			},
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			definitionReferences$: combineLatest({
				documentConfiguration: documentConfiguration$,
				value: configuration.dependencies$.pipe(
					switchMap((dependencies) => {
						return combineLatest({
							globals: dependencies.globals$,
							value: this.documentSymbols$.pipe(
								map((documentSymbols) => {
									return {
										base: VDFTextDocument.base(documentSymbols),
										value: {
											dependencies,
											documentSymbols,
											definitionReferences: dependencies.schema.getDefinitionReferences({
												dependencies: dependencies,
												documentSymbols: documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols(),
											}),
										}
									}
								}),
								(source$) => {
									const fs = (current: Uri, relativeFolderPath: string) => {
										const self = `${relativeFolderPath}/${current.basename()}`
										const external = ambient(current)
										return ({ stack, detail }: BaseValue): Observable<BaseResult<DefinitionReferences>> => {
											const path = posix.resolve(`/${relativeFolderPath}/${detail}`).substring(1)

											if (path.toLowerCase() == self.toLowerCase()) {
												return concat(
													of<BaseResult<DefinitionReferences>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
													NEVER
												)
											}

											const index = stack.findIndex((p) => p.path.toLowerCase() == path.toLowerCase())
											if (index != -1) {
												return concat(
													of<BaseResult<DefinitionReferences>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
													NEVER
												)
											}

											return fileSystem.resolveFile(path).pipe(
												switchMap((uri) => {
													if (uri != null) {
														return usingAsync(async () => await documents.get(uri)).pipe(
															switchMap((document) => {
																return document.base$.pipe(
																	map((base) => ({ base: base, value: undefined })),
																	combineLatestBaseFiles({
																		stack: [...stack, { path: path, uri: document.uri }],
																		open: fs(document.uri, posix.dirname(path))
																	}),
																	switchMap(({ base: results }) => {
																		if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
																			return document.definitionReferences$.pipe(
																				map((value) => ({ type: <const>BaseResultType.Success, ambient: false, value: value })),
																				finalize(() => {
																					document.setDocumentReferences(new Map<string, References | null>([[this.uri.toString(), null]]))
																				})
																			)
																		}

																		return of<BaseResult<DefinitionReferences>>({
																			type: <const>BaseResultType.Error,
																			self: self,
																			errors: results
																				.values()
																				.map((result) => {
																					switch (result.type) {
																						case BaseResultType.None:
																						case BaseResultType.Success:
																							return null
																						case BaseResultType.Error:
																							return {
																								type: <const>BaseErrorType.Base,
																								path: result.self,
																								errors: result.errors
																							}
																					}
																				})
																				.filter((error) => error != null)
																				.toArray()
																		})
																	})
																)
															})
														)
													}
													else {
														return external({ stack, detail })
													}
												})
											)
										}
									}

									const ambient = (current: Uri) => {
										const self = current.fsPath
										const dirname = current.dirname()
										return ({ stack, detail }: BaseValue): Observable<BaseResult<DefinitionReferences>> => {
											const uri = current.with({ path: posix.resolve(dirname.joinPath(detail).path) })
											const fsPath = uri.fsPath.toLowerCase()

											if (Uri.equals(current, uri) || current.fsPath.toLowerCase() == fsPath) {
												return concat(
													of<BaseResult<DefinitionReferences>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
													NEVER
												)
											}

											const index = stack.findIndex((p) => p.path.toLowerCase() == fsPath)
											if (index != -1) {
												return concat(
													of<BaseResult<DefinitionReferences>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
													NEVER
												)
											}

											return createFileSystemWatcher(uri).pipe(
												filter((type) => type != "change"),
												startWith(<const>"create"),
												switchMap((type) => {
													switch (type) {
														case "create":
															return usingAsync(async () => await documents.get(uri)).pipe(
																switchMap((document) => {
																	return document.base$.pipe(
																		map((base) => ({ base: base, value: undefined })),
																		combineLatestBaseFiles({
																			stack: [...stack, { path: document.uri.fsPath, uri: document.uri }],
																			open: ambient(document.uri),
																		}),
																		switchMap(({ base: results }) => {
																			if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
																				return document.definitionReferences$.pipe(
																					map((value) => ({ type: <const>BaseResultType.Success, ambient: true, value: value }))
																				)
																			}

																			return of<BaseResult<DefinitionReferences>>({
																				type: <const>BaseResultType.Error,
																				self: self,
																				errors: results
																					.values()
																					.map((result) => {
																						switch (result.type) {
																							case BaseResultType.None:
																							case BaseResultType.Success:
																								return null
																							case BaseResultType.Error:
																								return {
																									type: <const>BaseErrorType.Base,
																									path: result.self,
																									errors: result.errors
																								}
																						}
																					})
																					.filter((error) => error != null)
																					.toArray()
																			})
																		}),
																	)
																}),
																catchError(() => {
																	return concat(of({ type: <const>BaseResultType.None }), NEVER)
																})
															)
														case "delete":
															return concat(of({ type: <const>BaseResultType.None }), NEVER)
													}
												})
											)
										}
									}

									const open = configuration.relativeFolderPath != null
										? fs(init.uri, configuration.relativeFolderPath)
										: ambient(init.uri)

									return source$.pipe(
										combineLatestBaseFiles({
											stack: [],
											open: ({ stack, detail }) => {
												let observable$ = this.context.get(detail)
												if (!observable$) {
													observable$ = open({ stack, detail }).pipe(
														finalize(() => this.context.delete(detail)),
														shareReplay({ bufferSize: 1, refCount: true }),
													)
													this.context.set(detail, observable$)
												}
												return observable$
											},
										}),
										map(({ base: results, value }) => {
											const { definitionReferences, ...rest } = value

											const base = results
												.values()
												.filter((result) => result.type == BaseResultType.Success)
												.map((result) => result.value)
												.toArray()

											const definitions = value.definitionReferences.definitions.clone()

											for (const baseDefinitionReferences of base) {
												for (const { scope, type, key, value: baseDefinitions } of baseDefinitionReferences.definitions) {
													// Copy #base definitions to document, used for Goto Definition
													if (scope == null) {
														definitions.set(null, type, key, ...baseDefinitions)
													}
												}
											}

											return {
												...rest,
												base,
												definitionReferences: {
													scopes: definitionReferences.scopes,
													definitions: definitions,
													references: definitionReferences.references,
												}
											}
										})
									)
								}
							)
						}).pipe(
							map(({ globals, value }) => {
								for (const global of globals) {
									global.references.setDocumentReferences(this.uri, new References(this.uri, value.definitionReferences.references, []), true)
								}

								return {
									dependencies: value.dependencies,
									documentSymbols: value.documentSymbols,
									definitionReferences: {
										scopes: value.definitionReferences.scopes,
										definitions: new Definitions({
											version: [this.version, ...value.base.flatMap(({ definitions }) => definitions.version)],
											collection: value.definitionReferences.definitions,
											globals: globals.map(({ definitions }) => definitions)
										}),
										references: new References(this.uri, value.definitionReferences.references, value.base.map(({ references }) => references), this.references$)
									} satisfies DefinitionReferences
								}
							})
						)
					})
				)
			}).pipe(
				map(({ documentConfiguration, value }) => {
					return {
						dependencies: value.dependencies,
						documentConfiguration: documentConfiguration,
						documentSymbols: value.documentSymbols,
						definitionReferences: value.definitionReferences
					}
				})
			),
		})

		this.configuration = configuration

		const getBaseDiagnostics = (documentSymbol: VDFDocumentSymbol, error: BaseError): DiagnosticCodeAction[] => {
			switch (error.type) {
				case BaseErrorType.Self:
					return [{
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Error,
						code: "base-self-reference",
						source: "vdf",
						message: `#base directive '${error.detail}' #bases itself.`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove self #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					}]
				case BaseErrorType.Cyclic:
					return [{
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Error,
						code: "base-cyclic",
						source: "vdf",
						message: `#base directive is cyclic.`,
						relatedInformation: error.stack.map(({ uri }, index) => ({
							location: {
								uri: uri.toString(),
								range: new VDFRange(new VDFPosition(0, 0))
							},
							message: `#base -> "${error.stack[(index + 1) % error.stack.length].path}"`
						})),
						data: {
							fix({ createDocumentWorkspaceEdit }) {
								return {
									title: "Remove cyclic #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					} satisfies DiagnosticCodeAction]
				case BaseErrorType.Base:
					const path = error.path
					return error.errors.flatMap((error) => {
						return getBaseDiagnostics(documentSymbol, error).map((diagnostic) => {
							const { message, ...rest } = diagnostic
							return {
								message: `#base error in "${path}": ${diagnostic.message}`,
								...rest
							}
						})
					})
			}
		}

		this.getDiagnostics = (dependencies, documentConfiguration, documentSymbols, definitionReferences) => {
			const diagnostics: DiagnosticCodeActions = []

			const { base = [], rest = [] } = Object.groupBy(
				documentSymbols,
				(documentSymbol) => {
					return documentSymbol.key.toLowerCase() == "#base"
						? "base"
						: "rest"
				}
			)

			for (const documentSymbol of base) {
				if (documentSymbol.children) {
					diagnostics.push({
						range: documentSymbol.childrenRange!,
						severity: DiagnosticSeverity.Error,
						code: "invalid-base",
						source: "vdf",
						message: "Invalid #base directive.",
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove invalid #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					})
				}
				else if (documentSymbol.detail!.trim() == "") {
					diagnostics.push(this.diagnostics.unreachable(documentSymbol.range, ({ createDocumentWorkspaceEdit }) => {
						return {
							title: "Remove empty #base",
							edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
						}
					}))
				}
				else {
					const detail = documentSymbol.detail!.replaceAll(/[/\\]+/g, "/")
					const dirname = this.uri.dirname()

					const baseUri = dirname.joinPath(detail)
					const relative = dirname.relative(baseUri)

					if (detail != relative) {
						diagnostics.push({
							range: documentSymbol.detailRange!,
							severity: DiagnosticSeverity.Warning,
							code: "useless-path",
							source: "vdf",
							message: `Unnecessary relative file path. (Expected "${relative}")`,
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: "Normalize file path",
										edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, relative))
									}
								},
							}
						})
					}

					if (!this.context.has(detail)) {
						console.warn(`${this.uri.basename()}: !this.context.has("${detail}")`)
					}

					diagnostics.push(
						this.context.get(detail)?.pipe(
							map((result) => {
								switch (result.type) {
									case BaseResultType.None:
										return this.diagnostics.unreachable(documentSymbol.range)
									case BaseResultType.Success:
										if (!result.ambient) {
											return []
										}

										return [{
											range: documentSymbol.detailRange!,
											severity: DiagnosticSeverity.Hint,
											source: "vdf",
											message: "#base directive is ambient.",
										}]
									case BaseResultType.Error:
										return result.errors.flatMap((error) => {
											return getBaseDiagnostics(documentSymbol, error)
										})
								}
							})
						) ?? null
					)
				}
			}

			diagnostics.push(
				...dependencies.schema.getDiagnostics({
					dependencies: dependencies,
					documentConfiguration: documentConfiguration,
					documentSymbols: rest,
					definitionReferences: definitionReferences,
				})
			)

			return diagnostics
		}

		this.base$ = this.documentSymbols$.pipe(
			map((documentSymbols) => VDFTextDocument.base(documentSymbols)),
			distinctUntilChanged((previous, current) => previous.length == current.length && previous.every((detail, index) => detail == current[index])),
			shareReplay(1)
		)
	}

	public async getLinks(): Promise<DocumentLinkData[]> {
		const { documentSymbols, dependencies, definitionReferences } = await firstValueFrom(combineLatest({
			documentSymbols: this.documentSymbols$,
			dependencies: this.configuration.dependencies$,
			definitionReferences: this.definitionReferences$
		}))

		const { base = [], rest = [] } = Object.groupBy(
			documentSymbols,
			(documentSymbol) => {
				return documentSymbol.key.toLowerCase() == "#base"
					? "base"
					: "rest"
			}
		)

		return [
			...base
				.values()
				.filter((documentSymbol) => documentSymbol.detail != undefined)
				.map((documentSymbol) => ({
					range: documentSymbol.detailRange!,
					data: {
						resolve: async () => {
							if (this.configuration.relativeFolderPath) {
								const relativePath = posix.resolve(`/${this.configuration.relativeFolderPath}`, documentSymbol.detail!).substring(1)

								const target = await firstValueFrom(this.fileSystem.resolveFile(relativePath))
								if (target) {
									return target
								}
							}

							const dirname = this.uri.dirname()
							return dirname.with({ path: posix.resolve(dirname.path, documentSymbol.detail!) })
						}
					}
				})),
			...dependencies.schema.getLinks({
				documentSymbols: rest,
				definitionReferences: definitionReferences,
				resolve: (value, extension) => {
					value = value.replaceAll(/[/\\]+/g, "/")
					if (extension != undefined && posix.extname(value) != extension) {
						value += extension
					}
					return posix.resolve(`/${value}`).substring(1)
				},
			})
		]
	}

	public async getColours(): Promise<ColourInformationStringify[]> {
		const { documentSymbols, dependencies } = await firstValueFrom(combineLatest({
			documentSymbols: this.documentSymbols$,
			dependencies: this.configuration.dependencies$
		}))

		const { base = [], rest = [] } = Object.groupBy(
			documentSymbols,
			(documentSymbol) => {
				return documentSymbol.key.toLowerCase() == "#base"
					? "base"
					: "rest"
			}
		)

		return dependencies.schema.getColours({
			documentSymbols: rest,
			next: (callback) => {
				return rest.reduce(
					(colours, documentSymbol) => {
						if (!documentSymbol.children) {
							return colours
						}

						colours.push(
							...documentSymbol.children.reduceRecursive(
								<ColourInformationStringify[]>[],
								(colours, documentSymbol) => {
									callback(colours, documentSymbol)
									return colours
								}
							)
						)

						return colours
					},
					<ColourInformationStringify[]>[]
				)
			},
		})
	}

	public async getInlayHints(): Promise<InlayHint[]> {
		const { documentSymbols, dependencies } = await firstValueFrom(combineLatest({
			documentSymbols: this.documentSymbols$,
			dependencies: this.configuration.dependencies$
		}))

		const { base = [], rest = [] } = Object.groupBy(
			documentSymbols,
			(documentSymbol) => {
				return documentSymbol.key.toLowerCase() == "#base"
					? "base"
					: "rest"
			}
		)

		return dependencies.schema.getInlayHints({
			dependencies: dependencies,
			documentSymbols: rest
		})
	}
}
