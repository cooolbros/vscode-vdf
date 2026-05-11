import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import dedent from "dedent"
import { posix } from "path"
import { BehaviorSubject, combineLatest, filter, firstValueFrom, isObservable, map, Observable, of, shareReplay, switchMap } from "rxjs"
import { VDFRange, VDFSyntaxError, type RangeLike } from "vdf"
import type { FileType } from "vscode"
import { CodeAction, CodeLens, Color, ColorInformation, CompletionItem, CompletionItemKind, DiagnosticSeverity, DocumentLink, InlayHint, TextEdit, WorkspaceEdit, type CodeActionParams, type Diagnostic, type DocumentSymbol } from "vscode-languageserver"
import { TextDocument, type TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument"
import { References, type DefinitionReferences } from "./DefinitionReferences"
import type { TextDocumentRequestParams } from "./LanguageServer"

export interface TextDocumentInit {
	uri: Uri
	languageId: string
	version: number
	content: string
}

export interface TextDocumentBaseConfiguration<TDocumentSymbols extends DocumentSymbol[], TDependencies> {
	getDocumentSymbols(text: string): TDocumentSymbols
	defaultDocumentSymbols: TDocumentSymbols
	definitionReferences$: Observable<{
		dependencies: TDependencies,
		documentConfiguration: VSCodeVDFConfiguration,
		documentSymbols: TDocumentSymbols,
		definitionReferences: DefinitionReferences
	}>
}

export type DiagnosticCodeAction = Omit<Diagnostic, "data"> & { data?: { fix: ({ params, createDocumentWorkspaceEdit, findBestMatch }: { params: TextDocumentRequestParams<CodeActionParams>, createDocumentWorkspaceEdit: (edit: TextEdit) => WorkspaceEdit, findBestMatch: (mainString: string, targetStrings: string[]) => string | null }) => Omit<CodeAction, "kind" | "diagnostic" | "isPreferred"> | null } }

export type DiagnosticCodeActions = (DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | DiagnosticCodeAction[] | null>)[]

export type DocumentLinkData = Omit<DocumentLink, "range" | "data"> & { range: VDFRange, data: { resolve: () => Promise<Uri | null> } }

export type ColourInformationStringify = (ColorInformation & { stringify(colour: Color): string })

export abstract class TextDocumentBase<
	TDocumentSymbols extends DocumentSymbol[],
	TDependencies,
> implements AsyncDisposable {

	public static readonly conditionals = new Set([
		"[$DECK]",
		"[$LINUX]",
		"[$OSX]",
		"[$POSIX]",
		"[$WIN32]",
		"[$WINDOWS]",
		"[$X360]",
	])

	public static readonly diagnostics = {
		key: (name: string, key: string, range: VDFRange, edit?: { uri?: () => Uri, range?: () => VDFRange, newText?: (name: string) => string }): DiagnosticCodeAction | null => {
			if (name == key) {
				return null
			}

			return {
				range: range,
				severity: DiagnosticSeverity.Hint,
				message: name,
				data: {
					fix: ({ params }) => {
						const uri = edit?.uri?.() ?? params.textDocument.uri
						return {
							title: `Replace "${key}" with "${name}"`,
							edit: {
								changes: {
									[uri.toString()]: [TextEdit.replace(edit?.range?.() ?? range, edit?.newText?.(name) ?? name)]
								}
							}
						}
					}
				}
			}
		}
	}

	public readonly uri: Uri
	public readonly languageId: string
	public get version() {
		return this.document.version
	}

	protected readonly document: TextDocument
	protected readonly references$: BehaviorSubject<Map<string, References>>

	public readonly documentConfiguration$: Observable<VSCodeVDFConfiguration>
	public readonly fileSystem: FileSystemMountPoint

	public readonly text$: BehaviorSubject<string>
	public readonly documentSymbols$: Observable<TDocumentSymbols>
	public readonly definitionReferences$: Observable<DefinitionReferences>
	public readonly diagnostics$: Observable<DiagnosticCodeAction[]>
	public readonly codeLens$: Observable<CodeLens[]>

	public readonly definitions = {
		documentation: ({ documentation, range }: { documentation?: string, range: VDFRange }, languageId = this.languageId) => {
			return [
				...(documentation != undefined ? [documentation.replaceAll("\n", "\n\n")] : []),
				"```" + languageId,
				dedent(this.getText(range)),
				"```",
			].join("\n")
		}
	}

	public readonly completion = {
		files: async ({ folder, text, basenamePattern, filter, image = false }: { folder: string, text?: string, basenamePattern?: string, filter?: ([name, type]: [string, FileType], startsWithFilter: (name: string) => boolean) => boolean, image?: boolean, }): Promise<IteratorObject<CompletionItem>> => {
			const documentConfiguration = await firstValueFrom(this.documentConfiguration$)
			let startsWithFilter: (name: string) => boolean

			if (text != undefined) {
				const [last, ...rest] = text.split("/").reverse()
				if (rest.length) {
					folder += `/${rest.reverse().join("/")}`
				}
				const lastLowerCase = last.toLowerCase()
				startsWithFilter = (name) => name.toLowerCase().startsWith(lastLowerCase)
			}
			else {
				startsWithFilter = () => true
			}

			filter ??= (value) => startsWithFilter(value[0])

			folder = posix.resolve(`/${folder}`).substring(1)
			const recursive = documentConfiguration.filesAutoCompletionKind == "all"
			const pattern = basenamePattern && `${recursive ? "**/*" : ""}${basenamePattern}`
			const entries = await this.fileSystem.readDirectory(folder, { recursive, pattern })

			const incremental = documentConfiguration.filesAutoCompletionKind == "incremental"

			return entries
				.values()
				.filter((value) => filter(value, startsWithFilter))
				.map(([name, type]): CompletionItem => ({
					label: name,
					kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
					...(incremental && {
						commitCharacters: ["/"],
					}),
					...((image && type == 1) && {
						data: {
							image: {
								uri: this.uri,
								path: posix.join(folder, name)
							}
						},
					}),
				}))
		}
	}

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		configuration: TextDocumentBaseConfiguration<TDocumentSymbols, TDependencies>,
	) {
		this.uri = init.uri
		this.languageId = init.languageId
		this.document = TextDocument.create(init.uri.toString(), init.languageId, init.version, init.content)
		this.references$ = new BehaviorSubject(new Map())

		this.documentConfiguration$ = documentConfiguration$
		this.fileSystem = fileSystem

		this.text$ = new BehaviorSubject(this.document.getText())

		type Result = { success: true, value: TDocumentSymbols } | { success: false, value: VDFSyntaxError }

		const result$ = this.text$.pipe(
			map((text): Result => {
				try {
					return { success: true, value: configuration.getDocumentSymbols(text) }
				}
				catch (error: unknown) {
					if (error instanceof VDFSyntaxError) {
						return {
							success: false,
							value: error
						}
					}
					else {
						throw error
					}
				}
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.documentSymbols$ = result$.pipe(
			map((result, index) => {
				if (result.success) {
					return result.value
				}
				else {
					return index != 0
						? null
						: configuration.defaultDocumentSymbols
				}
			}),
			filter((documentSymbols): documentSymbols is TDocumentSymbols => documentSymbols != null),
			shareReplay(1)
		)

		const data$ = configuration.definitionReferences$.pipe(
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.definitionReferences$ = data$.pipe(
			map(({ definitionReferences }) => definitionReferences),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.diagnostics$ = result$.pipe(
			(source) => new Observable<Result>((subscriber) => {
				let first = true
				let previous: Result

				const subscription = source.subscribe((value) => {
					if (first) {
						first = false
						subscriber.next(value)
					}
					else if (!value.success) {
						subscriber.next(value)
					}
					else if (value.success != previous.success) {
						subscriber.next(value)
					}
					previous = value
				})

				return () => subscription.unsubscribe()
			}),
			switchMap((result) => {
				if (result.success) {
					return data$.pipe(
						map(({ dependencies, documentConfiguration, documentSymbols, definitionReferences }) => {
							return this.getDiagnostics(dependencies, documentConfiguration, documentSymbols, definitionReferences)
						}),
						switchMap((diagnostics) => {
							if (!diagnostics.length) {
								return of([])
							}

							return combineLatest(
								diagnostics.map((diagnostic) => isObservable(diagnostic) ? diagnostic : of(diagnostic))
							).pipe(
								map((diagnostics) => {
									return diagnostics.flat().filter((diagnostic) => diagnostic != null)
								})
							)
						})
					)
				}
				else {
					const error = result.value
					return of([
						{
							range: error.range,
							severity: DiagnosticSeverity.Error,
							code: error.name, // Don't use diagnostics.constructor.name because webpack obfuscates class names
							source: init.languageId,
							message: error.message
						} satisfies Diagnostic
					])
				}
			})
		)

		this.codeLens$ = this.definitionReferences$.pipe(
			switchMap((definitionReferences) => {
				return definitionReferences.references.references$.pipe(
					map(() => {
						return definitionReferences
					})
				)
			}),
			map((definitionReferences) => {
				return Iterator
					.from(definitionReferences.definitions)
					.reduce(
						(codeLens, { scope, type, key, value: definitions }) => {
							const definition = definitions[0]
							if (definition != undefined && Uri.equals(definition.uri, this.uri)) {
								const references = definitionReferences.references.collect(scope, type, key).toArray()

								if (references.length > 0) {
									codeLens.push({
										range: definition.range,
										command: {
											title: `${references.length} reference${references.length == 1 ? "" : "s"}`,
											command: "vscode-vdf.showReferences",
											arguments: [
												definition.uri,
												definition.keyRange.start,
												references
											]
										}
									})
								}
							}
							return codeLens
						},
						<CodeLens[]>[]
					)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)
	}

	public update(changes: TextDocumentContentChangeEvent[], version: number) {
		TextDocument.update(this.document, changes, version)
		this.text$.next(this.document.getText())
	}

	public getText(range?: RangeLike) {
		return this.document.getText(range)
	}

	public setDocumentReferences(references: Map<string, References | null>) {
		for (const [uri, documentReferences] of references) {
			if (documentReferences != null) {
				this.references$.value.set(uri, documentReferences)
			}
			else {
				this.references$.value.delete(uri)
			}
		}

		this.references$.next(this.references$.value)
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.text$.complete()
		await this.fileSystem[Symbol.asyncDispose]()
	}

	protected abstract getDiagnostics(dependencies: TDependencies, documentConfiguration: VSCodeVDFConfiguration, documentSymbols: TDocumentSymbols, definitionReferences: DefinitionReferences): DiagnosticCodeActions

	public abstract getLinks(): Promise<DocumentLinkData[]>

	public abstract getColours(): Promise<ColourInformationStringify[]>

	public abstract getInlayHints(): Promise<InlayHint[]>
}
