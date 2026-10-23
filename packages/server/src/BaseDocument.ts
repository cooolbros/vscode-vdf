import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { CompletionToken } from "common/generateTokens"
import { ambient, BaseErrorType, BaseResultType, combineLatestBaseFiles, fs, type BaseError, type BaseResult, type BaseValue } from "common/operators/combineLatestBaseFiles"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import { usingAsync } from "common/operators/usingAsync"
import { resolvePath } from "common/resolvePath"
import type { Uri } from "common/Uri"
import { VSCodeVDFLanguageNameSchema } from "common/VSCodeVDFLanguageID"
import { posix } from "path"
import { distinctUntilChanged, finalize, firstValueFrom, map, of, shareReplay, switchMap, type Observable, type OperatorFunction } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItemKind, DiagnosticSeverity, DiagnosticTag, InsertTextFormat, TextEdit } from "vscode-languageserver"
import { Definitions, type DefinitionReferences } from "./DefinitionReferences"
import type { DiagnosticsContext } from "./DiagnosticFactory"
import { TextDocumentBase, type DiagnosticCodeAction, type DocumentLinkResolve, type PartialDiagnosticCodeAction, type PartialDiagnosticCodeActionReference, type TextDocumentContent, type VDFCompletionItem, type VDFCompletionList, type VDFCompletionParams } from "./TextDocumentBase"
import type { TextDocument } from "./VDFLanguageServer"
import type { GlobalDefinitionReferences } from "./VDFWorkspace"

export type VDFTextDocumentLike = Extract<TextDocument, { documentSymbols$: Observable<VDFDocumentSymbols> }>

interface VDFTextDocumentBaseLike {
	uri: Uri,
	base$: Observable<string[]>,
	definitions$: Observable<Definitions>
	setReferences: TextDocumentBase<unknown, { [key: string]: GlobalDefinitionReferences }, VDFDocumentSymbols>["setReferences"]
}

/**
 * #base
 */
export class BaseDocument {

	public static base(documentSymbols: VDFDocumentSymbols) {
		return documentSymbols
			.values()
			.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "#base" && documentSymbol.value?.text.trim().length)
			.map((documentSymbol) => documentSymbol.value!.text.replaceAll(/[/\\]+/g, "/"))
			.toArray()
	}

	private readonly document: VDFTextDocumentLike
	private readonly context: Map<string, Observable<BaseResult<VDFTextDocumentBaseLike>>>

	/**
	 * #base
	 */
	public readonly base$: Observable<string[]>

	public constructor(document: VDFTextDocumentLike) {
		this.document = document
		this.context = new Map()

		this.base$ = document.documentSymbols$.pipe(
			map((documentSymbols) => BaseDocument.base(documentSymbols)),
			distinctUntilChanged((previous, current) => previous.length == current.length && previous.every((detail, index) => detail == current[index])),
			shareReplayUntilDisposed(document.dispose$),
		)
	}

	public combineLatestBaseDefinitions(getDefinitionReferences: (rest: VDFDocumentSymbol[]) => DefinitionReferences): OperatorFunction<VDFDocumentSymbols, TextDocumentContent<VDFDocumentSymbols>> {
		return (source$) => {
			const documentSelector = (uri: Uri, detail: string, ambient: boolean): Observable<BaseResult<VDFTextDocumentBaseLike>> => {
				return usingAsync(async () => await this.document.documents.get(uri)).pipe(
					switchMap((document) => {
						// concat(..., NEVER) is not needed because we are inside a switchMap
						// which will not complete and usingAsync doesn't complete
						switch (document.languageId) {
							case "hudanimations":
								return of({
									type: <const>BaseResultType.Error,
									self: document.uri.fsPath,
									errors: [
										{
											type: <const>BaseErrorType.Language,
											detail: detail,
											language: { id: document.languageId, name: VSCodeVDFLanguageNameSchema.shape[document.languageId].value }
										}
									]
								})
							case "popfile":
								return of({
									type: <const>BaseResultType.Success,
									value: document,
									ambient: ambient,
								})
							case "vdf":
								return document.schema$.pipe(
									switchMap(({ schema }) => {
										if ("base$" in schema) {
											return of({
												type: <const>BaseResultType.Success,
												value: {
													uri: document.uri,
													base$: schema.base$,
													definitions$: document.definitions$,
													setReferences: (uri, references) => document.setReferences(uri, references),
												} satisfies VDFTextDocumentBaseLike,
												ambient: ambient,
											})
										}
										else {
											return of({
												type: <const>BaseResultType.Error,
												self: document.uri.fsPath,
												errors: [
													{
														type: <const>BaseErrorType.Language,
														detail: detail,
														language: { id: schema.id, name: schema.name }
													}
												]
											})
										}
									})
								)
							case "vmt":
								return of({
									type: <const>BaseResultType.Success,
									value: document,
									ambient: ambient,
								})
						}
					})
				)
			}

			let open: ({ stack, detail }: BaseValue) => Observable<BaseResult<VDFTextDocumentBaseLike>>

			if (this.document.relativePath != null) {
				open = fs({
					current: this.document.uri,
					documentSelector,
					watch: (uri: Uri) => fromTRPCSubscription(this.document.trpc.vscode.workspace.createFileSystemWatcher, { uri }),
					preserve: true,
					fileSystem: this.document.fileSystem,
					relativeFolderPath: this.document.relativePath.folder
				})
			}
			else {
				open = ambient({
					current: this.document.uri,
					documentSelector,
					watch: (uri: Uri) => fromTRPCSubscription(this.document.trpc.vscode.workspace.createFileSystemWatcher, { uri }),
					preserve: false
				})
			}

			return source$.pipe(
				map((documentSymbols) => {
					const { base = [], rest = [] } = Object.groupBy(
						documentSymbols,
						(documentSymbol) => documentSymbol.key.text.toLowerCase() == "#base" ? "base" : "rest"
					)

					return {
						base: base
							.values()
							.map((documentSymbol) => documentSymbol.value?.text)
							.filter((text) => text != undefined)
							.toArray(),
						documentSymbols: documentSymbols,
						version: this.document.version,
						definitionReferences: getDefinitionReferences(rest)
					}
				}),
				combineLatestBaseFiles({
					stack: [],
					open: ({ stack, detail }) => {
						return this.context.getOrInsertComputed(detail, () => {
							return open({ stack, detail }).pipe(
								finalize(() => this.context.delete(detail)),
								shareReplay({ bufferSize: 1, refCount: true }),
							)
						}).pipe(
							switchMap((result) => {
								if (result.type != BaseResultType.Success) {
									return of(result)
								}

								const document = result.value
								document.setReferences(this.document.uri, this.document.references)

								return document.definitions$.pipe(
									map((definitions) => {
										return {
											type: <const>BaseResultType.Success,
											ambient: result.ambient,
											value: definitions
										}
									}),
									distinctUntilChanged((previous, current) => {
										return previous.value.version.length == current.value.version.length
											&& previous.value.version.every((value, index) => value == current.value.version[index])
									}),
								)
							})
						)
					}
				}),
				map(({ value, base: results }) => {
					const { documentSymbols, definitionReferences } = value
					const definitions = definitionReferences.definitions.clone()

					const base = results
						.values()
						.filter((result) => result.type == BaseResultType.Success)
						.map((result) => result.value)
						.toArray()

					// Copy #base definitions to document, used for Go to Definition
					for (const baseDefinitions of base) {
						for (const [type, map] of baseDefinitions.ofScope(null)) {
							for (const [key, value] of map) {
								definitions.set(null, type, key, ...value)
							}
						}
					}

					return {
						documentSymbols: documentSymbols,
						definitionReferences: {
							scopes: definitionReferences.scopes,
							definitions: new Definitions([value.version, ...base.flatMap((definitions) => definitions.version)], definitions),
							references: definitionReferences.references,
						},
					} satisfies TextDocumentContent<VDFDocumentSymbols>
				})
			)
		}
	}

	public getDiagnostics(diagnostics: PartialDiagnosticCodeAction[], context: DiagnosticsContext<{}, { [key: string]: GlobalDefinitionReferences }, VDFDocumentSymbols>) {
		const base = new Map<string, PartialDiagnosticCodeActionReference[]>()

		for (const documentSymbol of context.content.documentSymbols) {
			if (documentSymbol.key.text.toLowerCase() == "#base") {
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
							}
						}
					})
				}
				else if (!documentSymbol.value!.text.trim().length) {
					diagnostics.push({
						range: documentSymbol.range,
						severity: DiagnosticSeverity.Hint,
						message: "Unreachable code detected.",
						tags: [
							DiagnosticTag.Unnecessary
						],
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove empty #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							}
						}
					})
				}
				else {
					const detail = documentSymbol.value!.text.replaceAll(/[/\\]+/g, "/")
					const dirname = this.document.uri.dirname()

					const baseUri = dirname.joinPath(detail)
					const relative = dirname.relative(baseUri)

					if (detail != relative) {
						diagnostics.push({
							range: documentSymbol.value!.range,
							severity: DiagnosticSeverity.Warning,
							code: "useless-path",
							source: "vdf",
							message: `Unnecessary relative file path. (Expected "${relative}")`,
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: "Normalize file path",
										edit: createDocumentWorkspaceEdit(TextDocumentBase.replaceTokenTextEdit(documentSymbol.value!, relative))
									}
								}
							}
						})
					}

					base.getOrInsertComputed(detail, () => []).push({ index: diagnostics.length, name: "#base", documentSymbolRange: documentSymbol.range, value: documentSymbol.value! })
					diagnostics.push(undefined)
				}
			}
		}

		for (const [detail, values] of base) {
			const observable$ = this.context.get(detail)
			if (observable$) {
				context.subscriptions.push(
					observable$.subscribe((result) => {
						switch (result.type) {
							case BaseResultType.None: {
								for (const { index, documentSymbolRange } of values) {
									diagnostics[index] = {
										range: documentSymbolRange,
										severity: DiagnosticSeverity.Hint,
										source: "vdf",
										message: "Unreachable code detected.",
										tags: [
											DiagnosticTag.Unnecessary
										],
									}
								}
								break
							}
							case BaseResultType.Success: {
								if (result.ambient) {
									for (const { index, value } of values) {
										diagnostics[index] = {
											range: value.range,
											severity: DiagnosticSeverity.Hint,
											source: "vdf",
											message: "#base directive is ambient.",
										}
									}
								}
								else {
									for (const { index } of values) {
										diagnostics[index] = null
									}
								}
								break
							}
							case BaseResultType.Error: {
								const diagnostic = result.errors.flatMap((error) => this.getBaseErrorDiagnostics(error))
								for (const { index, value } of values) {
									diagnostics[index] = diagnostic.map((rest) => ({
										range: value.range,
										...rest
									}))
								}
								break
							}
						}

						context.next()
					})
				)
			}
			else {
				for (const { index } of values) {
					diagnostics[index] = null
				}
			}
		}
	}

	private getBaseErrorDiagnostics(error: BaseError, documentSymbol?: VDFDocumentSymbol): Omit<DiagnosticCodeAction, "range">[] {
		switch (error.type) {
			case BaseErrorType.Self:
				return [{
					severity: DiagnosticSeverity.Error,
					code: "base-self-reference",
					source: "vdf",
					message: `#base directive '${error.detail}' #bases itself.`,
					...(documentSymbol != undefined && {
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove self #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							}
						}
					})
				}]
			case BaseErrorType.Directory:
				return [{
					severity: DiagnosticSeverity.Error,
					code: "base-directory",
					source: "vdf",
					message: `#base directive '${error.detail}' #bases a directory.`,
					...(documentSymbol != undefined && {
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove directory #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					})
				}]
			case BaseErrorType.Language:
				return [{
					severity: DiagnosticSeverity.Error,
					code: `base-${error.language.id}`,
					source: "vdf",
					message: `#base directive '${error.detail}' #bases a ${error.language.name} file.`,
					...(documentSymbol != undefined && {
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: `Remove ${error.language.name} #base`,
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					})
				}]
			case BaseErrorType.Cyclic:
				return [{
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
					...(documentSymbol != undefined && {
						data: {
							fix({ createDocumentWorkspaceEdit }) {
								return {
									title: "Remove cyclic #base",
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							},
						}
					})
				}]
			case BaseErrorType.Base:
				const path = error.path
				return error.errors.flatMap((error) => {
					return this.getBaseErrorDiagnostics(error).map((diagnostic) => {
						return {
							...diagnostic,
							message: `#base error in "${path}": ${<string>diagnostic.message}`,
						}
					})
				})
		}
	}

	public getDocumentLinks(documentSymbols: VDFDocumentSymbols) {
		return documentSymbols
			.values()
			.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "#base" && documentSymbol.value?.text.trim().length)
			.map((documentSymbol): DocumentLinkResolve => ({
				range: documentSymbol.value!.range,
				data: {
					resolve: async () => {
						const relativePath = this.document.relativePath
						if (relativePath != null) {
							const path = resolvePath(`${relativePath.folder != null ? `${relativePath.folder}/` : ""}${documentSymbol.value!.text}`)
							const target = (await firstValueFrom(this.document.fileSystem.resolve(path))).uri
							if (target) {
								return target
							}
						}

						const dirname = this.document.uri.dirname()
						return dirname.with({ path: posix.resolve(dirname.path, documentSymbol.value!.text) })
					}
				}
			}))
	}

	public completionBaseKeys(params: VDFCompletionParams, token?: CompletionToken): VDFCompletionItem[] {
		const range = token != undefined
			? new VDFRange(new VDFPosition(params.position.line, token.start), new VDFPosition(params.position.line, token.end))
			: new VDFRange(params.position)

		const q = token?.quoted ? `"` : ""

		return [
			{
				label: "#base",
				kind: CompletionItemKind.Keyword,
				textEdit: TextEdit.replace(range, `${q}#base${q}\t"$0"`),
				insertTextFormat: InsertTextFormat.Snippet,
				command: {
					title: "Trigger Suggest",
					command: "editor.action.triggerSuggest"
				}
			}
		]
	}

	public async completionBaseValues(params: VDFCompletionParams, token?: CompletionToken): Promise<VDFCompletionList> {
		const basename = this.document.uri.basename().toLowerCase()
		const bases = new Set((await firstValueFrom(this.base$)).map((detail) => detail.toLowerCase()))

		if (this.document.relativePath != null) {
			return await params.files({
				folder: this.document.relativePath.folder ?? "",
				params: params,
				token: token,
				filter: ([name, _type], _startsWithFilter) => {
					const nameLowerCase = name.toLowerCase()
					return nameLowerCase != basename && !bases.has(nameLowerCase)
				},
			})
		}
		else {
			await using stack = new AsyncDisposableStack()
			const { key } = stack.adopt(
				await this.document.trpc.teamFortress2FileSystem.open.mutate({ paths: [{ type: "folder", folder: this.document.uri.dirname() }] }),
				async ({ key }) => await this.document.trpc.teamFortress2FileSystem.dispose.mutate({ key })
			)

			const fileSystem: Pick<FileSystemMountPoint, "readDirectory"> = {
				readDirectory: async (path, options) => {
					return await this.document.trpc.teamFortress2FileSystem.readDirectory.query({ key, path, options })
				}
			}

			return await params.files({
				folder: "",
				params: params,
				token: token,
				fileSystem: fileSystem,
				filter: ([name, _type], startsWithFilter) => {
					const nameLowerCase = name.toLowerCase()
					return startsWithFilter(name) && nameLowerCase != basename && !bases.has(nameLowerCase)
				},
			})
		}
	}
}
