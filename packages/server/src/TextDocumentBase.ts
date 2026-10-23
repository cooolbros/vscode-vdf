import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { generateTokens, type CompletionToken } from "common/generateTokens"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { resolvePath } from "common/resolvePath"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import dedent from "dedent"
import { Minimatch } from "minimatch"
import { posix } from "path"
import { BehaviorSubject, combineLatest, concatMap, connectable, defer, filter, finalize, firstValueFrom, identity, map, Observable, of, pairwise, ReplaySubject, shareReplay, startWith, Subject, switchAll, switchMap, type Connectable, type ObservedValueOf, type Subscription } from "rxjs"
import { VDFPosition, VDFRange, VDFSyntaxError, type PositionLike, type RangeLike } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { quote } from "vdf-format"
import { AnnotatedTextEdit, ApplyKind, ChangeAnnotation, CompletionItemKind, DiagnosticSeverity, Location, LocationLink, MarkupKind, TextDocumentEdit, TextEdit, type CodeAction, type CodeActionParams, type CodeLens, type CodeLensParams, type Color, type ColorInformation, type ColorPresentationParams, type CompletionItem, type CompletionList, type CompletionParams, type Connection, type DefinitionLink, type DefinitionParams, type Diagnostic, type DocumentFormattingParams, type DocumentLink, type DocumentSymbol, type Hover, type HoverParams, type InlayHint, type MarkupContent, type PrepareRenameParams, type PrepareRenamePlaceholder, type ReferenceParams, type RenameParams, type TextDocumentItem, type WorkspaceEdit } from "vscode-languageserver"
import { TextDocument as LanguageServerTextDocument, type TextDocumentContentChangeEvent } from "vscode-languageserver-textdocument"
import z from "zod"
import { Collection, Definitions, References, type Definition, type DefinitionReferences } from "./DefinitionReferences"
import type { DefinitionType } from "./DefinitionTypes"
import type { TextDocument, VDFLanguageServer } from "./VDFLanguageServer"
import type { GlobalDefinitionReferences } from "./VDFWorkspace"

export interface TextDocumentInit extends Omit<TextDocumentItem, "uri"> {
	uri: Uri
}

export type GlobalsLike<TGlobals> = { [P in keyof TGlobals]: GlobalDefinitionReferences }

export type GlobalsDefinitions<TGlobals extends GlobalsLike<TGlobals>> = { [P in keyof TGlobals]: ObservedValueOf<TGlobals[P]["definitions$"]> }

class Globals<TGlobals extends GlobalsLike<TGlobals>> {

	private readonly globals: TGlobals

	public constructor(globals: TGlobals) {
		this.globals = globals
	}

	public get(key: keyof TGlobals): GlobalDefinitionReferences {
		return this.globals[key]
	}

	public combineLatest(): Observable<GlobalsDefinitions<TGlobals>> {
		if (Object.keys(this.globals).length != 0) {
			const observables = <{ [P in keyof typeof this.globals]: Observable<Definitions> }>Object.fromEntries(Object.entries(this.globals).map(([name, global]) => <const>[name, (<GlobalDefinitionReferences>global).definitions$]))
			return combineLatest(observables)
		}
		else {
			return of(<GlobalsDefinitions<TGlobals>>{})
		}
	}

	public async find(scope: number | null, type: DefinitionType, key: string) {
		const globals = await firstValueFrom(this.combineLatest())
		return Object
			.values(globals)
			.values()
			.map((global) => (<Definitions>global).get(scope, type, key))
			.find((definition) => definition != null && definition.length > 0) ?? null
	}
}

export interface TextDocumentBaseConfiguration<TDependencies, TGlobals extends GlobalsLike<TGlobals>, TDocumentSymbols extends DocumentSymbol[]> {
	readonly path: string | null
	getDocumentSymbols(text: string): TDocumentSymbols
	readonly defaultDocumentSymbols: TDocumentSymbols
	readonly data$: Observable<TextDocumentData<TDependencies, TGlobals, TDocumentSymbols>>
}

export interface TextDocumentData<TDependencies, TGlobals extends GlobalsLike<TGlobals>, TDocumentSymbols extends DocumentSymbol[]> {
	readonly dependencies: TDependencies
	readonly globals: TGlobals
	readonly content$: Observable<TextDocumentContent<TDocumentSymbols>>
}

export interface TextDocumentContent<TDocumentSymbols extends DocumentSymbol[]> {
	readonly documentSymbols: TDocumentSymbols
	readonly definitionReferences: Omit<DefinitionReferences, "definitions"> & {
		readonly definitions: Definitions,
	}
}

export interface TextDocumentDiagnosticsParams<TDependencies, TGlobals extends GlobalsLike<TGlobals>, TDocumentSymbols extends DocumentSymbol[]> {
	diagnostics: PartialDiagnosticCodeAction[]
	dependencies: TDependencies
	globals: GlobalsDefinitions<TGlobals>
	content: TextDocumentContent<TDocumentSymbols>
	subscriptions: Subscription[]
	dispose$: Subject<void>
	next(this: void): void
}

/**
 * Diagnostic + Code Action
 */
export type DiagnosticCodeAction = Omit<Diagnostic, "data"> & { data?: { fix: DiagnosticFix } }

export type DiagnosticFix = (params: { params: CodeActionParams, createDocumentWorkspaceEdit(this: void, edit: TextEdit): WorkspaceEdit }) => Omit<CodeAction, "diagnostics"> | null

/**
 * Partial {@link DiagnosticCodeAction}
 *
 * | Type                     | State                |
 * |:-------------------------|:---------------------|
 * | `DiagnosticCodeAction`   | diagnostic           |
 * | `undefined`              | pending              |
 * | `DiagnosticCodeAction[]` | multiple diagnostics |
 * | `null`                   | no diagnostic        |
 */
export type PartialDiagnosticCodeAction = DiagnosticCodeAction | undefined | DiagnosticCodeAction[] | null

export type PartialDiagnosticCodeActionReference = { index: number, name: string, documentSymbolRange: VDFRange, value: VDFText }

export interface Decoration {
	range: VDFRange
	renderOptions: {
		after: {
			contentText: string
		}
	}
}

export type DocumentLinkResolve = Omit<DocumentLink, "range" | "target" | "data"> & { range: VDFRange, data: { resolve(this: void): Promise<Uri | null> } }

export type ColourInformationStringify = ColorInformation & { stringify(this: void, colour: Color): string }

export interface VDFRenameParams {
	readonly scope: number | null
	readonly type: DefinitionType
	readonly key: string
	readonly definitions: Readonly<Definition[]>
	readonly newName: string
}

export interface VDFCompletionParams {
	readonly position: VDFPosition
	readonly tokens: CompletionToken[]
	includes(token: CompletionToken): boolean
	bits(): VDFCompletionList
	files(params: VDFCompletionFilesParams): Promise<VDFCompletionList>
	conditionals(token?: CompletionToken): VDFCompletionList | null
}

export interface VDFCompletionFilesParams {
	folder: string,
	params: VDFCompletionParams
	token: CompletionToken | undefined,
	fileSystem?: Pick<FileSystemMountPoint, "readDirectory">,
	basenamePattern?: string,
	filter?(this: void, [name, type]: [string, number], startsWithFilter: (name: string) => boolean): boolean,
	map?: "name" | ((name: string) => string),
	image?: boolean
}

export interface VDFCompletionList {
	token?: CompletionToken | VDFRange
	length: number
	items: Iterator<VDFCompletionItem> | Iterable<VDFCompletionItem>
}

export interface VDFCompletionItem extends Omit<CompletionItem, "documentation" | "deprecated" | "insertText"> {
	documentation?: MarkupContent
}

export abstract class TextDocumentBase<
	TDependencies,
	TGlobals extends GlobalsLike<TGlobals>,
	TDocumentSymbols extends DocumentSymbol[],
> extends AsyncDisposableBase {

	public static readonly conditionals = new Set([
		"[$DECK]",
		"[$LINUX]",
		"[$OSX]",
		"[$POSIX]",
		"[$WIN32]",
		"[$WINDOWS]",
		"[$X360]",
	])

	public static replaceTokenTextEdit(token: VDFText, newText: string) {
		if (!token.quoted && quote(newText)) {
			return TextEdit.replace(token.tokenRange, `"${newText}"`)
		}
		else {
			return TextEdit.replace(token.range, newText)
		}
	}

	public readonly uri: Uri
	public readonly languageId: string
	public get version() {
		return this.document.version
	}

	private readonly document: LanguageServerTextDocument

	public readonly relativePath: { folder: string | null, path: string } | null
	public readonly documentConfiguration$: Observable<VSCodeVDFConfiguration>
	public readonly fileSystem: FileSystemMountPoint
	public readonly documents: RefCountAsyncDisposableFactory<Uri, TextDocument>
	public readonly trpc: TRPCClient<ClientRouter>

	public readonly text$: BehaviorSubject<string>
	public readonly data$: Connectable<{ dependencies: TDependencies, globals: Globals<TGlobals>, content: TextDocumentContent<TDocumentSymbols> }>
	public readonly documentSymbols$: Observable<TDocumentSymbols>
	public readonly definitions$: Observable<Definitions>
	public readonly diagnostics$: Observable<DiagnosticCodeAction[]>
	public readonly codeLens$: Observable<Observable<CodeLens[]>>
	private documentLinks: { version: number, promise: Promise<(Omit<DocumentLinkResolve, "data"> & { data: DocumentLinkResolve["data"] & { uri: Uri } })[]> } | null
	private documentColours: { version: number, promise: Promise<{ color: ColourInformationStringify[], map: Map<string, ColourInformationStringify> }> } | null

	public abstract readonly decorations$: Observable<Decoration[]>

	public readonly references: References
	private readonly referenceSubscriptions: Map<string, Subscription>

	protected rename: (
		| null
		| { scope: number | null, type: DefinitionType, key: string } & (
			| { kind: "definitions", definitions: Readonly<Definition[]> }
			| { kind: "references", references: Readonly<VDFText[]> }
		)
	)

	public readonly definitions = {
		documentation: ({ documentation, range }: { documentation?: string, range: VDFRange }) => {
			return [
				...(documentation != undefined ? [documentation.replaceAll("\n", "\n\n")] : []),
				`\`\`\`${this.languageId}`,
				dedent(this.getText(range)),
				"```",
			].join("\n")
		}
	}

	public constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TextDocument>,
		trpc: TRPCClient<ClientRouter>,
		configuration: TextDocumentBaseConfiguration<TDependencies, TGlobals, TDocumentSymbols>,
	) {
		super()

		this.uri = init.uri
		this.languageId = init.languageId
		this.document = LanguageServerTextDocument.create(init.uri.toString(), init.languageId, init.version, init.text)

		if (configuration.path) {
			const dirname = posix.dirname(configuration.path)
			this.relativePath = {
				folder: dirname != "." ? dirname : null,
				path: configuration.path
			}
		}
		else {
			this.relativePath = null
		}

		this.documentConfiguration$ = documentConfiguration$
		this.fileSystem = this.stack.use(fileSystem)
		this.documents = documents
		this.trpc = trpc

		this.text$ = new BehaviorSubject(this.document.getText())
		this.stack.defer(() => this.text$.complete())

		type Result = (
			| { success: true, documentSymbols: TDocumentSymbols }
			| { success: false, error: VDFSyntaxError, }
		)

		const result$ = this.text$.pipe(
			map((text): Result => {
				try {
					return { success: <const>true, documentSymbols: configuration.getDocumentSymbols(text) }
				}
				catch (error: unknown) {
					if (error instanceof VDFSyntaxError) {
						return {
							success: <const>false,
							error: error,
						}
					}
					else {
						throw error
					}
				}
			}),
			shareReplayUntilDisposed(this.dispose$)
		)

		this.data$ = connectable(
			configuration.data$.pipe(
				map((dependencies) => {
					// Don't use this.references because it forwards references from this to globals
					const references = this.references.detach()

					// Don't use finalize because it will remove global references on this[Symbol.asyncDispose]
					// Only remove global references on new globals
					const stack = new DisposableStack()

					for (const name in dependencies.globals) {
						const global = dependencies.globals[name]
						if (global.setReferences != undefined) {
							stack.adopt(global.setReferences(this.uri, references), (references) => references.remove())
						}
					}

					return {
						dependencies,
						stack
					}
				}),
				startWith(null),
				pairwise(),
				map(([previous, current]) => {
					previous?.stack.dispose()
					return current!
				}),
				switchMap(({ dependencies }) => {
					return dependencies.content$.pipe(
						map((content) => {
							return {
								dependencies: dependencies.dependencies,
								globals: new Globals(dependencies.globals),
								content: content,
							}
						})
					)
				}),
				map((value) => {
					this.references.collection$.next(value.content.definitionReferences.references)
					return value
				}),
				shareReplayUntilDisposed(this.dispose$),
			),
			{
				connector: () => new ReplaySubject(1),
				resetOnDisconnect: false
			}
		)

		this.documentSymbols$ = result$.pipe(
			map((result, index) => {
				if (result.success) {
					return result.documentSymbols
				}
				else {
					return index != 0
						? null
						: configuration.defaultDocumentSymbols
				}
			}),
			filter((documentSymbols): documentSymbols is TDocumentSymbols => documentSymbols != null),
			shareReplayUntilDisposed(this.dispose$)
		)

		this.definitions$ = this.data$.pipe(
			map(({ content }) => content.definitionReferences.definitions),
			shareReplayUntilDisposed(this.dispose$),
		)

		let ready = false

		// Do not pipe to a ReplaySubject!
		const diagnosticsDispose$ = new Subject<void>()

		this.diagnostics$ = result$.pipe(
			(source$) => new Observable<Result>((subscriber) => {
				let first = true
				let previous: Result

				return source$.subscribe((value) => {
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
			}),
			switchMap((result) => {
				if (result.success) {
					return this.data$.pipe(
						switchMap(({ dependencies, globals, content }) => {
							return globals.combineLatest().pipe(
								map((globals) => {
									return {
										dependencies,
										globals,
										content
									}
								})
							)
						}),
						switchMap(({ dependencies, globals, content }) => {
							return new Observable<Exclude<PartialDiagnosticCodeAction, undefined>[]>((subscriber) => {
								const diagnostics: PartialDiagnosticCodeAction[] = []
								const subscriptions: Subscription[] = []
								let done = false

								const next = () => {
									// Skip if !done because more diagnostics can be added
									if (done && diagnostics.every((diagnostic) => diagnostic !== undefined)) {
										subscriber.next(diagnostics)
										diagnosticsDispose$.next()
									}
								}

								this.getDiagnostics({ dependencies, globals, content, diagnostics, subscriptions, dispose$: diagnosticsDispose$, next })
								done = true
								next()

								return () => {
									for (const subscription of subscriptions) {
										subscription.unsubscribe()
									}
								}
							})
						}),
						map((diagnostics) => {
							ready = true
							return diagnostics
								.values()
								.filter((diagnostic) => diagnostic != null)
								.flatMap((value) => Array.isArray(value) ? value : [value])
								.toArray()
						}),
						// Send empty diagnostics to remove syntax error diagnostic on successful parse if this.data$ hasn't emitted yet
						ready ? identity : startWith([]),
					)
				}
				else {
					const error = result.error
					return of([
						{
							range: error.range,
							severity: DiagnosticSeverity.Error,
							code: error.name, // Don't use diagnostics.constructor.name because webpack obfuscates class names
							source: init.languageId,
							message: error.message
						} satisfies DiagnosticCodeAction
					])
				}
			}),
			finalize(() => {
				diagnosticsDispose$.next()
			})
		)

		this.codeLens$ = defer(() => combineLatest({
			definitions: this.definitions$,
			references: this.references.next$,
		})).pipe(
			map(({ definitions }) => {
				return defer(() => {
					return of(
						Iterator
							.from(definitions)
							.reduce(
								(codeLens, { scope, type, key, value: definitions }) => {
									for (const definition of definitions) {
										if (Uri.equals(definition.uri, this.uri)) {
											const references = this.references.collect(scope, type, key).toArray()
											if (references.length > 0) {
												codeLens.push({
													range: definition.range,
													command: {
														title: `${references.length} reference${references.length == 1 ? "" : "s"}`,
														command: "vscode-vdf.showReferences",
														arguments: [
															definition.uri,
															definition.keyToken.tokenRange.start,
															references.map((reference) => ({ uri: reference.uri, range: reference.reference.range }))
														]
													}
												})
											}
										}
									}

									return codeLens
								},
								<CodeLens[]>[]
							)
					)
				}).pipe(
					shareReplay(1)
				)
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		const collection$ = new BehaviorSubject(new Collection<VDFText>())
		this.stack.defer(() => collection$.complete())

		const references$ = new BehaviorSubject(new Map())
		this.stack.defer(() => references$.complete())

		this.references = new References(this.uri, collection$, references$)
		this.referenceSubscriptions = new Map()

		this.documentLinks = null
		this.documentColours = null
		this.rename = null
	}

	protected connect() {
		this.stack.adopt(this.data$.connect(), (connection) => connection.unsubscribe())
	}

	public async onDidOpenTextDocument(_server: VDFLanguageServer, _connection: Connection): Promise<AsyncDisposable> {
		return {
			[Symbol.asyncDispose]: async () => { }
		}
	}

	public update(changes: TextDocumentContentChangeEvent[], version: number) {
		LanguageServerTextDocument.update(this.document, changes, version)
		this.text$.next(this.document.getText())
	}

	public getText(range?: RangeLike) {
		return this.document.getText(range)
	}

	public offsetAt(position: PositionLike) {
		return this.document.offsetAt(position)
	}

	public setReferences(uri: Uri, references: References): { remove(): void } {
		const key = uri.toString()

		if (this.referenceSubscriptions.has(key)) {
			throw new Error(`[TextDocumentBase] Already set ${uri.toString()} references for ${this.uri.toString()}`)
		}

		this.references.references$.value.set(key, references)

		const subscription = references.next$.subscribe(() => this.references.references$.next(this.references.references$.value))
		subscription.add(() => this.referenceSubscriptions.delete(key))
		this.referenceSubscriptions.set(key, subscription)

		return {
			remove: () => {
				subscription.unsubscribe()
				this.references.references$.value.delete(key)
				this.references.references$.next(this.references.references$.value)
			}
		}
	}

	protected abstract getDiagnostics(params: TextDocumentDiagnosticsParams<TDependencies, TGlobals, TDocumentSymbols>): void

	public async VTFToPNGBase64(uri: Uri) {
		await using document = await this.documents.get(uri)
		if (document.languageId != "vmt") {
			return null
		}

		const baseTexture = await firstValueFrom(document.baseTexture$)
		if (!baseTexture) {
			return null
		}

		const vtf = await firstValueFrom(this.fileSystem.resolve(baseTexture))
		if (vtf.type != EntryType.File) {
			return null
		}

		return await this.trpc.VTFToPNGBase64.query({ uri: vtf.uri })
	}

	public async onHover(params: HoverParams): Promise<Hover | undefined> {
		const uri = new Uri(params.textDocument.uri)

		const { definitions, globals, collection, documentLinks } = await firstValueFrom(combineLatest({
			definitions: this.definitions$,
			globals: this.data$.pipe(switchMap((data) => data.globals.combineLatest())),
			collection: this.references.collection$,
			documentLinks: this.onDocumentLinks(),
		}))

		for (const { value } of definitions) {
			for (const definition of value) {
				if (Uri.equals(definition.uri, uri) && (definition.keyToken.range.contains(params.position) || definition.nameToken?.range.contains(params.position))) {
					return {
						contents: definition.documentation!,
						range: [definition.keyToken.range, definition.nameToken?.range].find((range) => range?.contains(params.position))!
					}
				}
			}
		}

		for (const { scope, type, key, value: references } of collection) {
			for (const reference of references) {
				if (reference.range.contains(params.position)) {
					let definition: readonly Definition[] | null
					definition ??= definitions.get(scope, type, key)
					definition ??= Object.values(globals).values().map((global) => (<Definitions>global).get(scope, type, key)).find((definition) => definition != null) ?? null

					if (definition?.[0].documentation) {
						return {
							contents: definition[0].documentation,
							range: reference.range
						}
					}
				}
			}
		}

		for (const documentLink of documentLinks) {
			if (documentLink.range.contains(params.position)) {
				const target = await documentLink.data.resolve()
				if (target != null && target.extname() == ".vmt") {
					const value = await this.VTFToPNGBase64(target)
					if (value) {
						return {
							contents: {
								kind: MarkupKind.Markdown,
								value: value,
							},
							range: documentLink.range
						}
					}
				}
			}
		}
	}

	public async onDefinition(params: DefinitionParams): Promise<Location[] | DefinitionLink[] | undefined> {
		for (const { scope, type, key, value: references } of this.references.collection$.value) {
			for (const reference of references) {
				if (reference.range.contains(params.position)) {
					let definition: readonly Definition[] | null
					definition ??= (await firstValueFrom(this.definitions$)).get(scope, type, key)
					definition ??= await firstValueFrom(this.data$.pipe(concatMap(async (data) => await data.globals.find(scope, type, key))))

					if (definition) {
						return definition.map((definition) => LocationLink.create(definition.uri.toString(), definition.range, definition.keyToken.range, reference.range))
					}
				}
			}
		}
	}

	public async onReferences(params: ReferenceParams): Promise<Location[] | undefined> {
		const definitions = await firstValueFrom(this.definitions$)
		for (const definition of definitions) {
			for (const value of definition.value) {
				if (Uri.equals(value.uri, this.uri) && value.keyToken.range.contains(params.position)) {
					return this.references
						.collect(definition.scope, definition.type, definition.key)
						.map((location) => Location.create(location.uri.toString(), location.reference.range))
						.toArray()
				}
			}
		}
	}

	public async onCodeLens(_params: CodeLensParams): Promise<CodeLens[]> {
		return await firstValueFrom(this.codeLens$.pipe(switchAll()))
	}

	public abstract onDocumentFormatting(params: DocumentFormattingParams): Promise<string>

	public async onDocumentLinks() {
		if (this.documentLinks?.version != this.version) {
			this.documentLinks = {
				version: this.version,
				promise: Promise.try(async () => {
					const documentLinks = await this.getDocumentLinks()
					return documentLinks.map((documentLink, index) => {
						return {
							...documentLink,
							data: {
								resolve: async () => await documentLink.data.resolve(),
								uri: this.uri,
								index: index,
							}
						}
					})
				})
			}
		}

		return await this.documentLinks.promise
	}

	protected abstract getDocumentLinks(): Promise<DocumentLinkResolve[]>

	public async onDocumentLinkResolve(documentLink: DocumentLink) {
		const { index } = z.object({ index: z.number() }).parse(documentLink.data)

		const resolve = (await this.documentLinks!.promise).at(index)?.data.resolve
		if (resolve == undefined) {
			// Document closed
			// https://github.com/cooolbros/vscode-vdf/issues/10
			return documentLink
		}

		documentLink.target = (await resolve())?.toString()
		console.log(documentLink.target)
		return documentLink
	}

	public async onDocumentColor(): Promise<ColourInformationStringify[]> {
		if (this.documentColours?.version != this.version) {
			this.documentColours = {
				version: this.version,
				promise: Promise.try(async () => {
					const colours = await this.getDocumentColor()
					return {
						color: colours,
						map: new Map(colours.values().map((colour) => <const>[`${colour.range.start.line}.${colour.range.start.character}.${colour.range.end.line}.${colour.range.end.character}`, colour]))
					}
				})
			}
		}

		return (await this.documentColours.promise).color
	}

	protected abstract getDocumentColor(): Promise<ColourInformationStringify[]>

	public async onColorPresentation(params: ColorPresentationParams) {
		const { color: colour, range } = params
		const stringify = (await this.documentColours!.promise).map.get(`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`)?.stringify
		if (stringify == undefined) {
			return []
		}

		return [{ label: stringify(colour) }]
	}

	public abstract onInlayHint(params: { range: VDFRange }): Promise<InlayHint[]>

	private async readonlyInclude() {
		const ReadonlyIncludeSchema = z.record(z.string(), z.boolean()).transform((arg) => Object.entries(arg).map(([pattern, include]) => {
			const match = new Minimatch(pattern)
			return include
				? (uri: Uri) => match.match(uri.toString())
				: (uri: Uri) => !match.match(uri.toString())
		}))

		const readonlyInclude = ReadonlyIncludeSchema.parse(await this.trpc.vscode.workspace.getConfiguration.query({ section: "files.readonlyInclude" }))

		return {
			test: async (uri: Uri) => {
				if (readonlyInclude.some((match) => match(uri))) {
					return true
				}

				const stat = await this.trpc.vscode.workspace.fs.stat.query({ uri })
				return ((stat.permissions ?? 0) & 1) == 1
			}
		}
	}

	public async onPrepareRename(params: PrepareRenameParams): Promise<PrepareRenamePlaceholder | null> {
		const definitions = await firstValueFrom(this.definitions$)

		const prepare = async (scope: number | null, type: DefinitionType, key: string) => {
			let definition: readonly Definition[] | null
			definition ??= definitions.get(scope, type, key)
			definition ??= await firstValueFrom(this.data$.pipe(concatMap(async (data) => await data.globals.find(scope, type, key))))

			if (definition != null && definition.length > 0) {
				const uris = new Map<string, Uri>(definition.map((definition) => <const>[definition.uri.toString(), definition.uri]))

				const readonly = await this.readonlyInclude()
				if ((await Promise.all(uris.values().map(async (uri) => await readonly.test(uri)))).some((result) => result)) {
					throw new Error(`Cannot rename readonly ${type.name} definition '${definition[0].key}'`)
				}

				this.rename = { kind: "definitions", scope: scope, type: type, key: key, definitions: definition }
				return definition[0].key
			}
			else {
				this.rename = { kind: "references", scope: scope, type: type, key: key, references: this.references.collection$.value.get(scope, type, key)! }
				return undefined
			}
		}

		for (const { scope, type, key, value } of definitions) {
			for (const definition of value) {
				if (Uri.equals(definition.uri, this.uri)) {
					if (definition.keyToken.range.contains(params.position)) {
						const placeholder = await prepare(scope, type, key)
						return {
							range: definition.keyToken.range,
							placeholder: placeholder!,
						}
					}
					else if (definition.nameToken?.range.contains(params.position)) {
						const placeholder = await prepare(scope, type, key)
						return {
							range: definition.nameToken.range,
							placeholder: placeholder!,
						}
					}
				}
			}
		}

		for (const { scope, type, key, value: references } of this.references.collection$.value) {
			for (const reference of references) {
				if (reference.range.contains(params.position)) {
					const placeholder = await prepare(scope, type, key)
					return {
						range: reference.range,
						placeholder: placeholder ?? type.toDefinition(reference.text),
					}
				}
			}
		}

		return null
	}

	public async onRenameRequest(params: RenameParams): Promise<WorkspaceEdit | null> {
		const rename = this.rename
		this.rename = null
		if (rename == null) {
			throw new Error("rename == null")
		}

		switch (rename.kind) {
			case "definitions": {
				return await this.getRename({
					scope: rename.scope,
					type: rename.type,
					key: rename.key,
					definitions: rename.definitions,
					newName: params.newName
				})
			}
			case "references": {
				const edits: TextEdit[] = []
				for (const token of this.references.collection$.value.get(rename.scope, rename.type, rename.key) ?? []) {
					edits.push(TextDocumentBase.replaceTokenTextEdit(token, rename.type.renameReference(token.text, params.newName)))
				}
				return { changes: { [this.uri.toString()]: edits } }
			}
		}
	}

	protected async getRename(params: VDFRenameParams): Promise<WorkspaceEdit> {

		const readonlyInclude = await this.readonlyInclude()
		const ids = <const>{
			rename: "rename",
			readonly: "readonly"
		}

		const uris = new Map<string, Uri>(params.definitions.map((definition) => <const>[definition.uri.toString(), definition.uri]))
		const changes = new Map<string, AnnotatedTextEdit[]>()

		const annotatedTextEditReplace = (token: VDFText, newText: string, id: keyof typeof ids) => {
			const textEdit = TextDocumentBase.replaceTokenTextEdit(token, newText)
			return AnnotatedTextEdit.replace(textEdit.range, textEdit.newText, id)
		}

		await Promise.all(uris.entries().map(async ([key, uri]) => {
			await using document = await this.documents.get(uri)

			const [definitions, readonly] = await Promise.all([
				firstValueFrom(document.definitions$),
				readonlyInclude.test(document.references.uri),
			])

			const id = readonly ? ids.readonly : ids.rename
			const annotatedTextEdits: AnnotatedTextEdit[] = []
			changes.set(key, annotatedTextEdits)

			for (const definition of definitions.get(params.scope, params.type, params.key) ?? []) {
				if (Uri.equals(definition.uri, uri)) {
					annotatedTextEdits.push(annotatedTextEditReplace(definition.keyToken, params.newName, id))
					if (definition.nameToken != undefined) {
						annotatedTextEdits.push(annotatedTextEditReplace(definition.nameToken, params.newName, id))
					}
				}
			}

			const ranges = document.references.collection$.value.get(params.scope, params.type, params.key) ?? []
			annotatedTextEdits.push(
				...ranges
					.values()
					.map((reference) => annotatedTextEditReplace(reference, params.type.renameReference(reference.text, params.newName), id))
			)

			const collect = async (references$: BehaviorSubject<Map<string, References>>) => {
				await Promise.all(
					references$.value
						.values()
						.map(async (references) => {
							const uri = references.uri.toString()
							if (changes.has(uri)) {
								return
							}

							const annotatedTextEdits: AnnotatedTextEdit[] = []
							changes.set(uri, annotatedTextEdits)

							await Promise.all([
								Promise.try(async () => {
									const readonly = await readonlyInclude.test(references.uri)
									const id = readonly ? ids.readonly : ids.rename
									const ranges = references.collection$.value.get(params.scope, params.type, params.key) ?? []

									annotatedTextEdits.push(
										...ranges
											.values()
											.map((reference) => annotatedTextEditReplace(reference, params.type.renameReference(reference.text, params.newName), id))
									)
								}),
								collect(references.references$)
							])
						})
				)
			}

			await collect(document.references.references$)
		}))

		return {
			documentChanges: changes
				.entries()
				.filter(([_uri, annotatedTextEdits]) => annotatedTextEdits.length > 0)
				.map(([uri, annotatedTextEdits]) => TextDocumentEdit.create({ uri: uri, version: null }, annotatedTextEdits))
				.toArray(),
			changeAnnotations: {
				[ids.rename]: ChangeAnnotation.create(params.newName, false),
				[ids.readonly]: ChangeAnnotation.create(params.newName, true),
			}
		}
	}

	public async onCompletion(params: CompletionParams): Promise<CompletionList | null> {

		const position = new VDFPosition(params.position.line, params.position.character)

		const line = this.getText(new VDFRange(position.with({ character: 0 }), position.with({ character: Infinity })))
		if (line.substring(position.character).includes("//")) {
			return null
		}

		// Parse entire line to include potential closing double quote after position.character
		const tokens = Array.from(generateTokens(line))

		// Remove tokens before and including opening brace,
		// so we suggest for the innermost key
		// https://github.com/cooolbros/vscode-vdf/issues/48
		tokens.splice(0, tokens.findLastIndex((token) => !token.quoted && token.value == "{") + 1)

		// Remove tokens after position.character
		const currentTokenIndex = tokens.findIndex((token) => token.start <= position.character && token.end >= position.character)
		if (currentTokenIndex != -1) {
			// If we are inside a token, remove all tokens after current
			tokens.splice(currentTokenIndex + 1)
		}
		else {
			// If we are outside a token, remove all tokens that start after position.character
			const nextTokenIndex = tokens.findIndex((token) => token.start > position.character)

			// Only if we are not the last token
			if (nextTokenIndex != -1) {
				tokens.splice(nextTokenIndex + 1)
			}
		}

		const includes = (token: CompletionToken) => {
			return token.quoted
				? position.character < token.end
				: position.character <= token.end
		}

		const bits = (): VDFCompletionList => {
			return {
				token: undefined,
				length: 2,
				items: [
					{
						label: "0",
						kind: CompletionItemKind.Unit,
					},
					{
						label: "1",
						kind: CompletionItemKind.Unit,
						preselect: true,
					},
				]
			}
		}

		const files = async ({ folder, params, token, fileSystem = this.fileSystem, basenamePattern, filter, map, image = false }: VDFCompletionFilesParams): Promise<VDFCompletionList> => {
			const documentConfiguration = await firstValueFrom(this.documentConfiguration$)

			let startsWithFilter: (name: string) => boolean
			if (token != undefined) {
				const [last, ...rest] = token.value.split("/").reverse()
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

			folder = resolvePath(folder)
			const recursive = documentConfiguration.filesAutoCompletionKind == "all"
			const pattern = basenamePattern && `${recursive ? "**/" : ""}${basenamePattern}`
			const entries = await fileSystem.readDirectory(folder, { recursive, pattern })

			const newText = typeof map == "string"
				? (name: string) => posix.parse(name).name
				: map ?? identity

			return {
				length: entries.length,
				items: entries
					.values()
					.filter((value) => filter(value, startsWithFilter))
					.map(([name, type]): VDFCompletionItem => ({
						label: name,
						kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
						textEdit: TextEdit.insert(params.position, newText(name)),
						...((image && type == 1) && {
							data: {
								image: {
									path: posix.join(folder, name)
								}
							},
						}),
					}))
			}
		}

		const conditionals = (token?: CompletionToken): VDFCompletionList | null => {
			if (token != undefined && token.quoted) {
				return null
			}

			return {
				token: token,
				length: TextDocumentBase.conditionals.size,
				items: TextDocumentBase
					.conditionals
					.values()
					.map((conditional) => {
						return {
							label: conditional,
							kind: CompletionItemKind.Variable, /* CompletionItemKind.Variable looks like a conditional */
						}
					})
			}
		}

		const completionList = await this.getCompletion({
			position,
			tokens,
			includes,
			bits,
			files,
			conditionals,
		})

		if (completionList == null) {
			return null
		}

		const { token, length, items } = completionList

		const range = token != undefined
			? token instanceof VDFRange
				? token
				: new VDFRange(new VDFPosition(position.line, token.start), new VDFPosition(position.line, token.end))
			: new VDFRange(position)

		const longest = length.toString().length

		return {
			isIncomplete: false,
			itemDefaults: {
				editRange: range,
				data: {
					uri: this.uri
				}
			},
			applyKind: {
				data: ApplyKind.Merge,
			},
			items: Iterator
				.from(items)
				.map((item, index) => {
					item.sortText = index.toString().padStart(longest, "0")
					item.filterText ??= item.textEdit?.newText ?? item.textEditText ?? item.label
					return item
				})
				.toArray()
		}
	}

	public async onCompletionResolve(item: CompletionItem) {
		const result = z.object({ path: z.string() }).safeParse(item.data)
		if (result.success) {
			const { path } = result.data
			const entry = await firstValueFrom(this.fileSystem.resolve(path))
			if (entry.type == EntryType.File) {
				const value = await this.VTFToPNGBase64(entry.uri)
				if (value != null) {
					item.documentation = {
						kind: MarkupKind.Markdown,
						value: `${value}\n\n${(<MarkupContent>item.documentation).value}`
					}
				}
			}
		}

		return item
	}

	protected abstract getCompletion(params: VDFCompletionParams): Promise<VDFCompletionList | null>
}
