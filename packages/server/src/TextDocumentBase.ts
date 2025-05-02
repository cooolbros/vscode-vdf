import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { BehaviorSubject, combineLatest, filter, isObservable, map, Observable, of, shareReplay, switchMap } from "rxjs"
import { VDFSyntaxError, type IRange } from "vdf"
import { CodeLens, DiagnosticSeverity, DocumentLink, type Diagnostic, type DocumentSymbol } from "vscode-languageserver"
import { TextDocument, type TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument"
import { DefinitionReferences, References } from "./DefinitionReferences"
import type { DiagnosticCodeAction } from "./LanguageServer"

export interface TextDocumentInit {
	uri: Uri
	languageId: string
	version: number
	content: string
}

export interface TextDocumentBaseConfiguration<TDocumentSymbols extends DocumentSymbol[], TDependencies> {
	getDocumentSymbols(text: string): TDocumentSymbols
	defaultDocumentSymbols: TDocumentSymbols
	definitionReferences$: Observable<{ dependencies: TDependencies, documentSymbols: TDocumentSymbols, definitionReferences: DefinitionReferences }>
	getDiagnostics(dependencies: TDependencies, documentSymbols: TDocumentSymbols, definitionReferences: DefinitionReferences): (DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | null>)[]
}

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

	public readonly uri: Uri
	protected readonly document: TextDocument
	protected readonly references: Map<string, References>
	protected readonly references$: BehaviorSubject<void>

	public readonly documentConfiguration$: Observable<VSCodeVDFConfiguration>
	public readonly fileSystem: FileSystemMountPoint

	public readonly text$: BehaviorSubject<string>
	public readonly documentSymbols$: Observable<TDocumentSymbols>
	public readonly definitionReferences$: Observable<DefinitionReferences>
	public readonly diagnostics$: Observable<DiagnosticCodeAction[]>
	public readonly codeLens$: Observable<CodeLens[]>
	public abstract readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri, resolve: () => Promise<Uri | null> } })[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		configuration: TextDocumentBaseConfiguration<TDocumentSymbols, TDependencies>,
	) {
		this.uri = init.uri
		this.document = TextDocument.create(init.uri.toString(), init.languageId, init.version, init.content)
		this.references = new Map()
		this.references$ = new BehaviorSubject<void>(undefined)

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

		const definitionReferences$ = configuration.definitionReferences$.pipe(
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.definitionReferences$ = definitionReferences$.pipe(
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
					return definitionReferences$.pipe(
						map(({ dependencies, documentSymbols, definitionReferences }) => {
							return configuration.getDiagnostics(dependencies, documentSymbols, definitionReferences)
						}),
						switchMap((diagnostics) => {
							if (!diagnostics.length) {
								return of([])
							}

							return combineLatest(
								diagnostics.map((diagnostic) => isObservable(diagnostic) ? diagnostic : of(diagnostic))
							).pipe(
								map((diagnostics) => {
									return diagnostics.filter((diagnostic) => diagnostic != null)
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
							if (definition != undefined && definition.uri.equals(this.uri)) {
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

	public getText(range?: IRange) {
		return this.document.getText(range)
	}

	public setDocumentReferences(references: Map<string, References | null>) {
		for (const [uri, documentReferences] of references) {
			if (documentReferences != null) {
				this.references.set(uri, documentReferences)
			}
			else {
				this.references.delete(uri)
			}
		}

		this.references$.next()
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.text$.complete()
		await this.fileSystem[Symbol.asyncDispose]()
	}
}
