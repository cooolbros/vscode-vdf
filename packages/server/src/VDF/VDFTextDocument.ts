import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, combineLatestWith, concat, connectable, defer, distinctUntilChanged, finalize, firstValueFrom, map, NEVER, Observable, of, ReplaySubject, shareReplay, Subscription, switchMap } from "rxjs"
import { VDFRange, type VDFParserOptions } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { CompletionItem, DiagnosticSeverity, DiagnosticTag, InlayHint, TextEdit } from "vscode-languageserver"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "../DefinitionReferences"
import type { CompletionFiles } from "../LanguageServer"
import { TextDocumentBase, type ColourInformationStringify, type DiagnosticCodeAction, type DiagnosticCodeActions, type DocumentLinkData, type TextDocumentInit } from "../TextDocumentBase"

export interface VDFTextDocumentConfiguration<TDocument extends VDFTextDocument<TDocument>> {
	relativeFolderPath: string | null
	VDFParserOptions: VDFParserOptions
	keyTransform: (key: string) => string,
	dependencies$: Observable<VDFTextDocumentDependencies<TDocument>>
}

export interface VDFTextDocumentDependencies<TDocument extends VDFTextDocument<TDocument>> {
	schema: VDFTextDocumentSchema<TDocument>
	globals$: Observable<DefinitionReferences[]>
}

export interface VDFTextDocumentSchema<TDocument extends VDFTextDocument<TDocument>> {
	keys: Record<string, { reference?: string[], values?: { label: string, kind: number, multiple?: boolean }[] }>
	values: Record<string, { kind: number, enumIndex?: boolean, values: string[], fix?: Record<string, string> }>
	getDefinitionReferences(params: DefinitionReferencesHandlerParams<TDocument>): { scopes: Map<symbol, Map<number, VDFRange>>, definitions: Collection<Definition>, references: Collection<VDFRange> }
	definitionReferences: Map<symbol, { keys: Set<string>, toReference?: ((name: string) => string) }>
	getDiagnostics(params: DiagnosticsHandlerParams<TDocument>): DiagnosticCodeActions
	getLinks(params: DocumentLinksHandlerParams<TDocument>): DocumentLinkData[]
	getColours(params: DocumentColoursHandlerParams<TDocument>): ColourInformationStringify[]
	getInlayHints(params: DocumentInlayHintsHandlerParams<TDocument>): Promise<InlayHint[]>
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
		values?: Record<string, CompletionItem[] | ((args: { text?: string, files: CompletionFiles }) => Promise<CompletionItem[]>)>
	}
}

export interface DefinitionReferencesHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	dependencies: VDFTextDocumentDependencies<TDocument>
	document: VDFTextDocument<TDocument>
	documentSymbols: VDFDocumentSymbols
}

export interface DiagnosticsHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	dependencies: VDFTextDocumentDependencies<TDocument>
	documentConfiguration: VSCodeVDFConfiguration
	documentSymbols: VDFDocumentSymbol[]
	definitionReferences: DefinitionReferences
}

export interface DocumentLinksHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	documentSymbols: VDFDocumentSymbol[]
	definitionReferences: DefinitionReferences
	resolve: (value: string, extension?: `.${string}`) => string
}

export interface DocumentColoursHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	documentSymbols: VDFDocumentSymbol[]
	next: (callback: (colours: ColourInformationStringify[], documentSymbol: VDFDocumentSymbol) => void) => ColourInformationStringify[]
}

export interface DocumentInlayHintsHandlerParams<TDocument extends VDFTextDocument<TDocument>> {
	dependencies: VDFTextDocumentDependencies<TDocument>
	documentSymbols: VDFDocumentSymbol[]
}

export const enum VGUIAssetType {
	None = 0,
	Image = 1
}

const enum BaseResultType {
	Self,
	None,
	Error,
	Success,
}

type BaseResult<TDocument extends VDFTextDocument<TDocument>> = (
	| { type: BaseResultType.Self }
	| { type: BaseResultType.None }
	| { type: BaseResultType.Error, paths: string[][] }
	| { type: BaseResultType.Success, document: VDFTextDocument<TDocument> }
)

export interface Context<TDocument extends VDFTextDocument<TDocument>> {
	dependencies: VDFTextDocumentDependencies<TDocument>,
	documentConfiguration: VSCodeVDFConfiguration,
	documentSymbols: VDFDocumentSymbols | undefined,
	definitionReferences: DefinitionReferences,
}

export type Validate<TDocument extends VDFTextDocument<TDocument>> = (name: string, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDocument>) => DiagnosticCodeActions

export const enum KeyDistinct {
	None,
	First,
	Last,
}

export type RefineString<TDocument extends VDFTextDocument<TDocument>> = (name: string, detail: string, detailRange: VDFRange, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDocument>) => DiagnosticCodeActions

export type Fallback<TDocument extends VDFTextDocument<TDocument>> = (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], context: Context<TDocument>, unknown: () => DiagnosticCodeActions) => DiagnosticCodeActions

export abstract class VDFTextDocument<TDocument extends VDFTextDocument<TDocument>> extends TextDocumentBase<VDFDocumentSymbols, VDFTextDocumentDependencies<TDocument>> {

	public readonly configuration: VDFTextDocumentConfiguration<TDocument>

	protected getDiagnostics: (dependencies: VDFTextDocumentDependencies<TDocument>, configuration: VSCodeVDFConfiguration, documentSymbols: VDFDocumentSymbols, definitionReferences: DefinitionReferences) => DiagnosticCodeActions

	/**
	 * #base
	 */
	public readonly base$: Observable<string[]>

	private readonly context = new Map<string, Observable<BaseResult<TDocument>>>()

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
		header: (validate: Validate<TDocument>, multiple: boolean): VDFTextDocumentSchema<TDocument>["getDiagnostics"] => {
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
		documentSymbols: (distinct: KeyDistinct, unknown: (key: string, parent: string, documentSymbol: VDFDocumentSymbol, context: Context<TDocument>) => DiagnosticCodeActions = (key, parent, documentSymbol) => [{ range: documentSymbol.nameRange, severity: DiagnosticSeverity.Warning, code: "unknown-key", source: this.languageId, message: `Unknown key '${key}'.` }]) => {
			return (schema: Record<string, [Validate<TDocument>] | [Validate<TDocument>, KeyDistinct]>, fallback?: Fallback<TDocument>): Validate<TDocument> => {
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
									const find = data.distinct == KeyDistinct.First
										? Array.prototype.find
										: Array.prototype.findLast

									const first = find.call(parent.children, (i: VDFDocumentSymbol) => i.key.toLowerCase() == documentSymbol.key.toLowerCase() && i.conditional?.toLowerCase() == documentSymbol.conditional?.toLowerCase())!
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

								if (documentSymbol.key != data.key) {
									diagnostics.push({
										range: documentSymbol.nameRange,
										severity: DiagnosticSeverity.Hint,
										message: data.key,
										data: {
											fix: ({ createDocumentWorkspaceEdit }) => {
												return {
													title: `Replace "${documentSymbol.key}" with "${data.key}"`,
													edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.nameRange, data.key))
												}
											}
										}
									})
								}

								diagnostics.push(...data.validate(data.key, documentSymbol, [...path, parent], context))
							}
						})
					}
					return diagnostics
				}
			}
		},
		string: (refine?: RefineString<TDocument>): Validate<TDocument> => {
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
		length: (max: number): RefineString<TDocument> => {
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
		}) satisfies RefineString<TDocument>,
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
		}) satisfies RefineString<TDocument>,
		set: (values: string[], fix?: Record<string, string>): RefineString<TDocument> => {
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
					if (detail != value) {
						return [{
							range: detailRange,
							severity: DiagnosticSeverity.Hint,
							message: value,
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: `Replace "${detail}" with "${value}"`,
										edit: createDocumentWorkspaceEdit(TextEdit.replace(detailRange, value))
									}
								}
							}
						}]
					}
					return []
				}
			}
		},
		dynamic: (key: string): RefineString<TDocument> => {
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
		reference: (type: symbol, refine?: (...args: [...Parameters<RefineString<TDocument>>, definitions: readonly Definition[]]) => DiagnosticCodeActions): RefineString<TDocument> => {
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

					diagnostics.push(...refine?.(key, detail, detailRange, documentSymbol, path, context, definitions) ?? [])
				}

				return diagnostics
			}
		},
		file: (name: string, folder: string | null, extension: string | null): RefineString<TDocument> => {
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
		next: (schema: Record<string, RefineString<TDocument>>): Validate<TDocument> => {
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
		documents: RefCountAsyncDisposableFactory<Uri, TDocument>,
		configuration: VDFTextDocument<TDocument>["configuration"],
	) {
		super(init, documentConfiguration$, fileSystem, {
			getDocumentSymbols: (text) => {
				return getVDFDocumentSymbols(text, configuration.VDFParserOptions)
			},
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			definitionReferences$: defer(() => this.documentSymbols$).pipe(
				combineLatestWith(configuration.dependencies$, defer(() => this.documentConfiguration$)),
				map(([documentSymbols, dependencies, documentConfiguration]) => {
					const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children
					return {
						dependencies: dependencies,
						documentConfiguration: documentConfiguration,
						documentSymbols: documentSymbols,
						base: documentSymbols
							.values()
							.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
							.map((documentSymbol) => posix.resolve("/", configuration.relativeFolderPath ?? "", documentSymbol.detail!.replaceAll(/[/\\]+/g, "/")).substring(1))
							.toArray(),
						...dependencies.schema.getDefinitionReferences({
							dependencies,
							document: this,
							documentSymbols: header ?? new VDFDocumentSymbols()
						})
					}
				}),
				(source$) => {

					function check(path: string, stack: string[]): Observable<BaseResult<TDocument>> {

						const index = stack.findIndex((p) => p.toLowerCase() == path.toLowerCase())
						if (index != -1) {
							return concat(
								of({
									type: <const>BaseResultType.Error,
									paths: [
										[...stack.slice(index), path]
									]
								}),
								// Don't .complete() or Observable will be removed from this.context
								NEVER
							)
						}

						return fileSystem.resolveFile(path).pipe(
							switchMap((uri) => {
								if (uri == null) {
									return of({ type: <const>BaseResultType.None })
								}

								return usingAsync(async () => await documents.get(uri)).pipe(
									switchMap((document) => {
										return document.base$.pipe(
											map((paths) => {
												return paths.map((p) => check(p, [...stack, path]))
											}),
											combineLatestPersistent(),
											map((results) => {
												if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
													return { type: <const>BaseResultType.Success, document: document }
												}

												return {
													type: <const>BaseResultType.Error,
													paths: results
														.values()
														.filter((result) => result.type == BaseResultType.Error)
														.map((result) => result.paths.flat())
														.toArray()
												}
											})
										)
									})
								)
							})
						)
					}

					const context = new Map<string, { connectable$: Observable<DefinitionReferences | null>, subscription: Subscription }>()

					return source$.pipe(
						switchMap((value) => {
							const observables = value.base.map((path) => {
								let value = context.get(path)
								if (!value) {
									let observable$ = this.context.get(path)
									if (!observable$) {
										const self = posix.resolve(`/${configuration.relativeFolderPath ?? ""}`, this.uri.basename()).substring(1)
										observable$ = (
											path.toLowerCase() == self.toLowerCase()
												? concat(of({ type: BaseResultType.Self } satisfies BaseResult<TDocument>), NEVER)
												: check(path, [self])
										).pipe(
											finalize(() => this.context.delete(path)),
											shareReplay({ bufferSize: 1, refCount: true })
										)
										this.context.set(path, observable$)
									}

									const connectable$ = connectable(
										observable$.pipe(
											switchMap((result) => {
												switch (result.type) {
													case BaseResultType.Self:
													case BaseResultType.None:
													case BaseResultType.Error:
														return of(null)
													case BaseResultType.Success:
														return result.document.definitionReferences$.pipe(
															finalize(() => {
																result.document.setDocumentReferences(new Map<string, References | null>([[this.uri.toString(), null]]))
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
										connectable$: connectable$,
										subscription: connectable$.connect()
									}

									context.set(path, value)
								}

								return value.connectable$
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
										documentConfiguration: value.documentConfiguration,
										documentSymbols: value.documentSymbols,
										definitionReferences: {
											scopes: value.scopes,
											definitions: new Definitions({
												version: [this.version, ...base.flatMap(({ definitions }) => definitions.version)],
												collection: definitions,
												globals: globals.map(({ definitions }) => definitions)
											}),
											references: new References(this.uri, value.references, base.map(({ references }) => references), this.references$)
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
			)
		})

		this.configuration = configuration

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

					const relativePath = configuration.relativeFolderPath
						? posix.resolve(`/${configuration.relativeFolderPath}/${detail}`).substring(1)
						: dirname.relative(dirname.joinPath(detail))

					diagnostics.push(
						this.context.get(relativePath)!.pipe(
							map((result) => {
								switch (result.type) {
									case BaseResultType.Self:
										return {
											range: documentSymbol.detailRange!,
											severity: DiagnosticSeverity.Error,
											code: "base-self-reference",
											source: "vdf",
											message: "#base directive references itself.",
											data: {
												fix({ createDocumentWorkspaceEdit }) {
													return {
														title: "Remove self #base",
														edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
													}
												},
											}
										}
									case BaseResultType.None:
										return this.diagnostics.unreachable(documentSymbol.range)
									case BaseResultType.Error:
										return {
											range: documentSymbol.detailRange!,
											severity: DiagnosticSeverity.Error,
											code: "base-cyclic",
											source: init.languageId,
											message: [
												"#base directive is cyclic.",
												...result.paths.map((paths) => paths.map((path) => `"${path}"`).join(" -> "))
											].join("\n"),
											data: {
												fix({ createDocumentWorkspaceEdit }) {
													return {
														title: "Remove cyclic #base",
														edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
													}
												},
											}
										}
									case BaseResultType.Success:
										return null
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
