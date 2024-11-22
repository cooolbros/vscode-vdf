import type { Uri } from "common/Uri"
import { BehaviorSubject, combineLatest, filter, isObservable, map, Observable, of, shareReplay, switchMap } from "rxjs"
import type { VSCodeVDFConfiguration } from "utils/types/VSCodeVDFConfiguration"
import { VDFSyntaxError, type IRange } from "vdf"
import { CodeLens, DiagnosticSeverity, DocumentLink, type Diagnostic, type DocumentSymbol } from "vscode-languageserver"
import { TextDocument, type TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument"
import { DefinitionReferences } from "./DefinitionReferences"
import type { DiagnosticCodeAction } from "./LanguageServer"
import { TeamFortress2FileSystem } from "./TeamFortress2FileSystem"

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
	getCodeLens(definitionReferences$: Observable<DefinitionReferences>): Observable<DefinitionReferences>
}

export abstract class TextDocumentBase<
	TDocumentSymbols extends DocumentSymbol[],
	TDependencies,
> {

	public readonly uri: Uri
	protected readonly document: TextDocument

	public readonly documentConfiguration$: Observable<VSCodeVDFConfiguration>
	public readonly fileSystem$: Observable<TeamFortress2FileSystem>

	private readonly text$: BehaviorSubject<string>

	public readonly documentSymbols$: Observable<TDocumentSymbols>
	public readonly definitionReferences$: Observable<DefinitionReferences>
	public readonly diagnostics$: Observable<DiagnosticCodeAction[]>
	public readonly codeLens$: Observable<CodeLens[]>
	public abstract readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri, resolve: () => Promise<Uri | null> } })[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		configuration: TextDocumentBaseConfiguration<TDocumentSymbols, TDependencies>,
	) {
		this.uri = init.uri
		this.document = TextDocument.create(init.uri.toString(), init.languageId, init.version, init.content)

		this.documentConfiguration$ = documentConfiguration$
		this.fileSystem$ = fileSystem$

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
			shareReplay(1)
		)

		const documentSymbols$ = result$.pipe(
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
			filter((documentSymbols): documentSymbols is TDocumentSymbols => documentSymbols != null)
		)

		this.documentSymbols$ = documentSymbols$.pipe(
			shareReplay(1)
		)

		this.definitionReferences$ = configuration.definitionReferences$.pipe(
			map(({ definitionReferences }) => definitionReferences),
			shareReplay(1)
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
					return configuration.definitionReferences$.pipe(
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

		this.codeLens$ = configuration.getCodeLens(this.definitionReferences$).pipe(
			switchMap((definitionReferences) => {
				return definitionReferences.references$.pipe(
					map(() => {
						return definitionReferences
					})
				)
			}),
			map((definitionReferences) => {
				return Iterator
					.from(definitionReferences.definitions)
					.reduce(
						(codeLens, { type, key, value: definitions }) => {
							const definition = definitions[0]
							if (definition != undefined && definition.uri.equals(this.uri)) {

								const references = definitionReferences
									.references
									.values()
									.flatMap((references) => references.get(type, key).map((range) => ({ uri: references.uri, range: range })))
									.toArray()

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
			shareReplay(1)
		)
	}

	public update(changes: TextDocumentContentChangeEvent[], version: number) {
		TextDocument.update(this.document, changes, version)
		this.text$.next(this.document.getText())
	}

	public getText(range?: IRange) {
		return this.document.getText(range)
	}

	public dispose() {
		this.text$.complete()
	}
}
