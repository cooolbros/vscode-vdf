import { createTRPCClient, httpBatchLink, type CreateTRPCClientOptions, type TRPCClient } from "@trpc/client"
import { initTRPC, type AnyTRPCRouter, type TRPCCombinedDataTransformer } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import type { Client } from "client"
import type { TRPCClientRouter } from "client/TRPCClientRouter"
import { devalueTransformer } from "common/devalueTransformer"
import { Uri } from "common/Uri"
import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { posix } from "path"
import { BehaviorSubject, concatMap, defer, distinctUntilChanged, distinctUntilKeyChanged, firstValueFrom, from, map, Observable, shareReplay, Subject, Subscription, switchMap, tap, zip } from "rxjs"
import { findBestMatch } from "string-similarity"
import { VDFPosition, VDFRange } from "vdf"
import type { FileType } from "vscode"
import { CodeAction, CodeActionKind, CodeLensRefreshRequest, CompletionItem, CompletionItemKind, Diagnostic, DidChangeConfigurationNotification, DocumentLink, DocumentSymbol, MarkupKind, TextDocumentSyncKind, TextEdit, WorkspaceEdit, type CodeActionParams, type CodeLensParams, type CompletionParams, type Connection, type DefinitionParams, type DidSaveTextDocumentParams, type DocumentFormattingParams, type DocumentLinkParams, type DocumentSymbolParams, type GenericRequestHandler, type PrepareRenameParams, type ReferenceParams, type RenameParams, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { Definitions, References } from "./DefinitionReferences"
import type { HUDAnimationsLanguageServer } from "./HUDAnimations/HUDAnimationsLanguageServer"
import { TeamFortress2FileSystem } from "./TeamFortress2FileSystem"
import { TextDocumentBase, type TextDocumentInit } from "./TextDocumentBase"
import { TextDocuments } from "./TextDocuments"
import type { PopfileLanguageServer } from "./VDF/Popfile/PopfileLanguageServer"
import type { VGUILanguageServer } from "./VDF/VGUI/VGUILanguageServer"
import type { VMTLanguageServer } from "./VDF/VMT/VMTLanguageServer"

const capabilities = {
	textDocumentSync: TextDocumentSyncKind.Incremental,
	completionProvider: {
		triggerCharacters: [
			"[",
			"/",
			"\"",
			"#",
		],
		resolveProvider: true,
	},
	definitionProvider: true,
	referencesProvider: true,
	documentSymbolProvider: true,
	codeActionProvider: true,
	codeLensProvider: {
		resolveProvider: false
	},
	documentLinkProvider: {
		resolveProvider: true,
	},
	documentFormattingProvider: true,
	renameProvider: {
		prepareProvider: true
	}
} satisfies ServerCapabilities

export interface LanguageServerConfiguration<TDocument extends TextDocumentBase<TDocumentSymbols, TDependencies>, TDocumentSymbols extends DocumentSymbol[], TDependencies> {
	servers: Set<VSCodeVDFLanguageID>
	/**
	 * https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
	 */
	capabilities: Omit<ServerCapabilities, keyof typeof capabilities>
	createDocument(init: TextDocumentInit, documentConfiguration$: Observable<VSCodeVDFConfiguration>, refCountDispose: (dispose: () => void) => void): Promise<TDocument>
}

export type TextDocumentRequestParams<T extends { textDocument: { uri: string } }> = ({ textDocument: { uri: Uri } }) & Omit<T, "textDocument">

export type DiagnosticCodeAction = Omit<Diagnostic, "data"> & { data?: { kind: (typeof CodeActionKind)[keyof (typeof CodeActionKind)], fix: ({ createDocumentWorkspaceEdit, findBestMatch }: { createDocumentWorkspaceEdit: (range: VDFRange, newText: string) => WorkspaceEdit, findBestMatch: (mainString: string, targetStrings: string[]) => string | null }) => Omit<CodeAction, "kind" | "diagnostic" | "isPreferred"> | null } }

export type CompletionFiles = (path: string, options: CompletionFilesOptions) => Promise<CompletionItem[]>

export interface CompletionFilesOptions {
	value: string | null
	extensionsPattern: `.${string}` | null
	callbackfn?: (name: string, type: FileType) => Partial<Omit<CompletionItem, "label" | "kind" | "sortText">> | null
	image?: boolean
}

export abstract class LanguageServer<
	TLanguageId extends VSCodeVDFLanguageID,
	TDocument extends TextDocumentBase<TDocumentSymbols, TDependencies>,
	TDocumentSymbols extends DocumentSymbol[],
	TDependencies
> {

	protected readonly languageId: TLanguageId
	protected readonly connection: Connection
	protected readonly languageServerConfiguration: LanguageServerConfiguration<TDocument, TDocumentSymbols, TDependencies>
	protected readonly teamFortress2Folder$: Observable<Uri>
	protected readonly fileSystems: {
		get: (paths: (teamFortress2Folder: Uri) => ({ type: "folder" | "tf2" | "vpk" | "wildcard", uri: Uri } | null)[]) => Observable<TeamFortress2FileSystem>
	}
	protected readonly documents: TextDocuments<TDocument>

	private readonly documentDiagnostics: WeakMap<TDocument, Map<string, DiagnosticCodeAction>>
	private readonly documentsLinks: WeakMap<TDocument, Map<string, (documentLink: DocumentLink) => Promise<Uri | null>>>

	private oldName: [symbol, string] | null = null

	protected readonly trpc: {
		client: TRPCClient<ReturnType<typeof TRPCClientRouter>>
		servers: {
			hudanimations: TRPCClient<ReturnType<HUDAnimationsLanguageServer["router"]>>
			popfile: TRPCClient<ReturnType<PopfileLanguageServer["router"]>>
			vgui: TRPCClient<ReturnType<VGUILanguageServer["router"]>>
			vmt: TRPCClient<ReturnType<VMTLanguageServer["router"]>>
		}
	}

	constructor(
		languageId: TLanguageId,
		name: z.infer<typeof VSCodeVDFLanguageNameSchema>[TLanguageId],
		connection: Connection,
		languageServerConfiguration: LanguageServerConfiguration<TDocument, TDocumentSymbols, TDependencies>,
	) {
		this.languageId = languageId
		this.connection = connection
		this.languageServerConfiguration = languageServerConfiguration

		const onDidChangeConfiguration$ = new BehaviorSubject<void>(undefined)

		this.teamFortress2Folder$ = defer(() => this.trpc.client.teamFortress2FileSystem.teamFortress2Folder.query()).pipe(
			switchMap((observable) => observable),
			distinctUntilChanged((a, b) => Uri.equals(a, b)),
			shareReplay(1)
		)

		const fileSystems = new Map<string, { value: TeamFortress2FileSystem, references: 0 }>()

		this.fileSystems = {
			get: (paths): Observable<TeamFortress2FileSystem> => {
				return this.teamFortress2Folder$.pipe(
					map((teamFortress2Folder) => {
						return paths(teamFortress2Folder)
							.filter((path, index, arr): path is NonNullable<typeof path> => {
								return path != null && arr.indexOf(path) == index
							})
					}),
					distinctUntilChanged((a, b) => {
						return a.length == b.length && a.every((value, i) => value.type == b[i].type && value.uri.equals(b[i].uri))
					}),
					concatMap(async (paths) => {
						return await this.trpc.client.teamFortress2FileSystem.open.mutate({ paths })
					}),
					map(({ key, paths }) => {
						let fileSystem = fileSystems.get(key)
						if (!fileSystem) {
							fileSystem = {
								value: new TeamFortress2FileSystem(
									paths.map(({ uri }) => uri),
									{
										resolveFile: (path) => {
											return from(this.trpc.client.teamFortress2FileSystem.resolveFile.query({ key, path })).pipe(
												switchMap((observable) => observable)
											)
										},
										readDirectory: async (path, options) => {
											return await this.trpc.client.teamFortress2FileSystem.readDirectory.query({ key, path, options })
										},
										dispose: () => {
											fileSystem!.references--
											if (fileSystem!.references == 0) {
												this.trpc.client.teamFortress2FileSystem.dispose.mutate({ key })
												fileSystems.delete(key)
											}
										}
									}
								),
								references: 0
							}

							fileSystems.set(key, fileSystem)
						}

						fileSystem.references++
						return fileSystem.value
					}),
					(source) => defer(() => {
						let previous: { dispose(): void } | undefined = undefined
						return source.pipe(
							tap({
								next: (value) => {
									previous?.dispose()
									previous = value
								},
								finalize: () => {
									previous?.dispose()
								}
							})
						)
					}),
					shareReplay({
						bufferSize: 1,
						refCount: true
					})
				)
			}
		}

		this.connection.onDidChangeConfiguration((params) => {
			onDidChangeConfiguration$.next()
		})

		this.documents = new TextDocuments({
			open: async (uri) => {
				return await this.trpc.client.workspace.openTextDocument.query({ uri, languageId: languageId })
			},
			create: async (init, dispose) => {
				return await languageServerConfiguration.createDocument(
					init,
					onDidChangeConfiguration$.pipe(
						concatMap(async () => {
							return VSCodeVDFConfigurationSchema.parse(await this.connection.workspace.getConfiguration({ scopeUri: init.uri.toString(), section: "vscode-vdf" }))
						}),
						shareReplay({
							bufferSize: 1,
							refCount: true
						})
					),
					dispose
				)
			},
			onDidOpen: async (event) => {
				const subscriptions: Subscription[] = []

				subscriptions.push(
					event.document.documentConfiguration$.pipe(
						distinctUntilKeyChanged("updateDiagnosticsEvent"),
						switchMap(({ updateDiagnosticsEvent }) => {
							return updateDiagnosticsEvent == "type"
								? event.document.diagnostics$
								: new Subject<DiagnosticCodeAction[]>()
						})
					).subscribe((diagnostics) => {
						this.sendDiagnostics(event.document, diagnostics)
					})
				)

				subscriptions.push(
					event.document.definitionReferences$.pipe(
						switchMap((definitionReferences) => definitionReferences.references.references$)
					).subscribe(() => {
						this.connection.sendRequest(CodeLensRefreshRequest.method)
					})
				)

				const { onDidClose } = await this.onDidOpen(event)

				return () => {
					this.sendDiagnostics(event.document, [])

					onDidClose()

					for (const subscription of subscriptions) {
						subscription.unsubscribe()
					}

					event.document.dispose()
				}
			}
		})

		this.documentDiagnostics = new WeakMap()
		this.documentsLinks = new WeakMap()

		this.connection.onInitialize(async (params) => {
			this.connection.console.log(`${name} Language Server`)
			return {
				serverInfo: {
					name: `${name} Language Server`
				},
				capabilities: {
					// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
					...languageServerConfiguration.capabilities,
					...capabilities,
				},
				servers: [...this.languageServerConfiguration.servers]
			}
		})

		this.connection.onInitialized(async (params) => {
			await this.connection.client.register(DidChangeConfigurationNotification.type)
		})

		this.onTextDocumentRequest(this.connection.onDidSaveTextDocument, this.onDidSaveTextDocument)
		this.onTextDocumentRequest(this.connection.onCompletion, this.onCompletion)
		this.connection.onCompletionResolve((item) => this.onCompletionResolve(item))
		this.onTextDocumentRequest(this.connection.onDefinition, this.onDefinition)
		this.onTextDocumentRequest(this.connection.onReferences, this.onReferences)
		this.onTextDocumentRequest(this.connection.onDocumentSymbol, this.onDocumentSymbol)
		this.onTextDocumentRequest(this.connection.onCodeAction, this.onCodeAction)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(
			this.connection.onDocumentFormatting,
			async (params: TextDocumentRequestParams<DocumentFormattingParams>) => {
				try {
					using document = await this.documents.get(params.textDocument.uri)
					return await this.onDocumentFormatting(document, params)
				}
				catch (error) {
					console.error(error)
					return null
				}
			}
		)
		this.onTextDocumentRequest(this.connection.onDocumentLinks, this.onDocumentLinks)
		this.connection.onDocumentLinkResolve((documentLink) => this.onDocumentLinkResolve(documentLink))
		this.onTextDocumentRequest(this.connection.onPrepareRename, this.onPrepareRename)
		this.onTextDocumentRequest(this.connection.onRenameRequest, this.onRenameRequest)

		let _router: AnyTRPCRouter

		const transformer = devalueTransformer({
			reducers: {
				Definitions: (value: unknown) => value instanceof Definitions && value.toJSON(),
				References: (value: unknown) => value instanceof References && value.toJSON(),
			},
			revivers: {
				Definitions: (value: ReturnType<Definitions["toJSON"]>) => Definitions.schema.parse(value),
				References: (value: ReturnType<References["toJSON"]>) => References.schema.parse(value),
			},
			name: this.languageId,
			subscriptions: [],
			onRequest: (method, handler) => this.connection.onRequest(method, handler),
			onNotification: (method, handler) => this.connection.onNotification(method, handler),
			sendRequest: async (server, method, param) => {
				if (server != null) {
					return await this.connection.sendRequest("vscode-vdf/sendRequest", { server, method, param } satisfies z.infer<typeof Client["sendSchema"]>)
				}
				else {
					return await this.connection.sendRequest(method, param)
				}
			},
			sendNotification: async (server, method, param) => {
				await this.connection.sendNotification("vscode-vdf/sendNotification", { server, method, param } satisfies z.infer<typeof Client["sendSchema"]>)
			},
		}) satisfies TRPCCombinedDataTransformer

		const resolveTRPC = async (input: string, init?: RequestInit) => {
			_router ??= this.router(initTRPC.create({ transformer: transformer, isDev: true }))
			const response = await fetchRequestHandler({
				endpoint: "",
				req: new Request(new URL(input, "https://vscode.vdf"), init),
				router: _router
			})
			return await response.text()
		}

		this.connection.onRequest("vscode-vdf/trpc", async (params: unknown) => {
			const [url, init] = z.tuple([
				z.string(),
				z.object({
					method: z.string().optional(),
					headers: z.record(z.string()).optional(),
					body: z.string().optional()
				})
			]).parse(params)

			return await resolveTRPC(url, init)
		})

		const VSCodeRPCOptions = (server: VSCodeVDFLanguageID | null) => ({
			links: [
				httpBatchLink({
					url: "",
					transformer: transformer,
					fetch: async (input, init) => {
						let body: string

						if (server != languageId) {
							body = await this.connection.sendRequest(
								"vscode-vdf/trpc",
								[
									server,
									[
										input,
										{
											method: init?.method,
											headers: init?.headers,
											body: init?.body
										}
									]
								]
							)
						}
						else {
							let url = typeof input == "object"
								? ("url" in input ? input.url : input.pathname)
								: input
							body = await resolveTRPC(url, init)
						}

						return new Response(body)
					}
				})
			]
		} satisfies CreateTRPCClientOptions<AnyTRPCRouter>)

		this.trpc = {
			client: createTRPCClient<ReturnType<typeof TRPCClientRouter>>(VSCodeRPCOptions(null)),
			servers: {
				hudanimations: createTRPCClient<ReturnType<HUDAnimationsLanguageServer["router"]>>(VSCodeRPCOptions("hudanimations")),
				popfile: createTRPCClient<ReturnType<PopfileLanguageServer["router"]>>(VSCodeRPCOptions("popfile")),
				vgui: createTRPCClient<ReturnType<VGUILanguageServer["router"]>>(VSCodeRPCOptions("vdf")),
				vmt: createTRPCClient<ReturnType<VMTLanguageServer["router"]>>(VSCodeRPCOptions("vmt")),
			}
		}

		this.documents.listen(this.connection)
		this.connection.listen()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>) {
		return t.router({
			textDocument: {
				documentSymbol: t
					.procedure
					.input(
						z.object({
							uri: Uri.schema
						})
					)
					.query(async ({ input }) => {
						return await this.onDocumentSymbol({ textDocument: input })
					}),
				references: t
					.procedure
					.input(
						z.object({
							textDocument: z.object({
								uri: Uri.schema
							}),
							position: VDFPosition.schema,
							context: z.object({
								includeDeclaration: z.boolean()
							})
						})
					)
					.query(async ({ input }) => await this.onReferences(input)),
				rename: t
					.procedure
					.input(
						z.object({
							textDocument: z.object({
								uri: Uri.schema
							}),
							oldName: z.object({
								type: z.symbol(),
								key: z.string(),
							}),
							newName: z.string(),
						})
					)
					.query(async ({ input }) => {
						using document = await this.documents.get(input.textDocument.uri, true)
						return await this.rename(document, input.oldName.type, input.oldName.key, input.newName)
					})
			},
		})
	}

	protected onTextDocumentRequest<P extends { textDocument: { uri: string } }, R, E>(
		listener: (handler: GenericRequestHandler<R | null, E>) => { dispose(): void },
		callback: (params: TextDocumentRequestParams<P>) => R | null | Promise<R | null>
	) {
		const fn = callback.bind(this)
		listener(async (params) => {
			try {
				const { textDocument, ...rest } = params
				return await fn({
					...rest,
					textDocument: { uri: new Uri(textDocument.uri) }
				})
			}
			catch (error: any) {
				console.trace(listener, error.message)
				throw error
			}
		})
	}

	protected async VTFToPNG(uri: Uri, path: string) {
		try {
			using document = await this.documents.get(uri, true)
			return await firstValueFrom(
				document.fileSystem$.pipe(
					switchMap((fileSystem) => fileSystem.resolveFile(path)),
					concatMap(async (uri) => uri != null ? await this.trpc.servers.vmt.baseTexture.query({ uri }) : null),
					concatMap(async (uri) => uri != null ? this.trpc.client.VTFToPNG.mutate({ uri }) : null),
				)
			)
		}
		catch (error) {
			console.error(error)
			return null
		}
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<TDocument>): Promise<{ onDidClose: () => void }> {
		return {
			onDidClose: () => {
				this.documentDiagnostics.delete(event.document)
				this.documentsLinks.delete(event.document)
			}
		}
	}

	protected async onDidSaveTextDocument(params: TextDocumentRequestParams<DidSaveTextDocumentParams>) {
		using document = await this.documents.get(params.textDocument.uri)
		const documentConfiguration = await firstValueFrom(document.documentConfiguration$)

		if (documentConfiguration.updateDiagnosticsEvent == "save") {
			const diagnostics = await firstValueFrom(document.diagnostics$)
			this.sendDiagnostics(document, diagnostics)
		}
	}

	private sendDiagnostics(document: TDocument, diagnostics: DiagnosticCodeAction[]) {

		const result: Diagnostic[] = []
		const map = new Map<string, DiagnosticCodeAction>()

		for (const diagnostic of diagnostics) {
			const id = crypto.randomUUID()
			const { data, ...rest } = diagnostic
			map.set(id, diagnostic)
			result.push({ ...rest, data: { id } })
		}

		this.documentDiagnostics.set(document, map)

		this.connection.sendDiagnostics({
			uri: document.uri.toString(),
			diagnostics: result
		})
	}

	private async onDocumentLinks(params: TextDocumentRequestParams<DocumentLinkParams>) {

		using document = await this.documents.get(params.textDocument.uri)
		const links = await firstValueFrom(document.links$)

		this.documentsLinks.set(
			document,
			new Map(links.map(({ range, data }) => [`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`, data.resolve]))
		)

		return links
	}

	private async onDocumentLinkResolve(documentLink: DocumentLink) {

		const { range, data } = documentLink

		const { uri } = z.object({ uri: Uri.schema }).parse(data)
		using document = await this.documents.get(uri)

		const resolve = this.documentsLinks
			?.get(document)
			?.get(`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`)

		if (resolve == undefined) {
			// Document closed
			// https://github.com/cooolbros/vscode-vdf/issues/10
			return documentLink
		}

		documentLink.target = (await resolve(documentLink))?.toString()
		return documentLink
	}

	private async onCompletion(params: TextDocumentRequestParams<CompletionParams>) {
		try {
			using document = await this.documents.get(params.textDocument.uri)
			const configuration = await firstValueFrom(document.documentConfiguration$)
			if (!configuration[this.languageId].suggest.enable) {
				return null
			}

			const position = new VDFPosition(params.position.line, params.position.character)

			const items = await this.getCompletion(
				document,
				position,
				async (path: string, { value, extensionsPattern, callbackfn, image }: CompletionFilesOptions) => {
					return await firstValueFrom(
						zip([document.fileSystem$, document.documentConfiguration$]).pipe(
							concatMap(async ([fileSystem, documentConfiguration]) => {

								let startsWithFilter: ([name, type]: [string, FileType]) => boolean

								if (value) {
									const [last, ...rest] = value.split("/").reverse()
									if (rest.length) {
										path += `/${rest.reverse().join("/")}`
									}
									startsWithFilter = ([name]) => name.toLowerCase().startsWith(last)
								}
								else {
									startsWithFilter = () => true
								}

								path = posix.resolve(`/${path}`).substring(1)

								const entries = await fileSystem.readDirectory(path, {
									recursive: documentConfiguration.filesAutoCompletionKind == "all",
									pattern: extensionsPattern != null
										? `**/*${extensionsPattern}`
										: undefined
								})

								const incremental = documentConfiguration.filesAutoCompletionKind == "incremental"

								return entries
									.values()
									.filter(startsWithFilter)
									.map(
										callbackfn == undefined
											? ([name, type]: [string, FileType]): CompletionItem | null => ({
												label: name,
												kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
												...(incremental && {
													commitCharacters: ["/"],
												}),
											})
											: ([name, type]: [string, FileType], index: number): CompletionItem | null => {
												const rest = callbackfn(name, type)
												if (!rest) {
													return null
												}

												return {
													label: name,
													kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
													...(incremental && {
														commitCharacters: ["/"],
													}),
													...(image && type == 1 && {
														data: {
															image: {
																uri: document.uri,
																path: posix.join(path, name)
															}
														},
													}),
													...rest
												}
											}
									)
									.filter((item) => item != null)
									.toArray()
							})
						)
					)
				},
				(text?: string) => {
					const [before, after] = document.getText(new VDFRange(
						position.with({ character: position.character - 1 }),
						position.with({ character: position.character + 1 }),
					))

					const start = before == "[" ? 1 : 0
					const end = after == "]" ? -1 : undefined

					return TextDocumentBase
						.conditionals
						.values()
						.filter((conditional) => text ? conditional.toLowerCase().startsWith(text.toLowerCase()) : true)
						.map((conditional) => {
							return {
								label: conditional,
								kind: CompletionItemKind.Variable,
								insertText: conditional.slice(start, end)
							} as CompletionItem
						})
						.toArray()
				}
			)

			if (!items) {
				return null
			}

			const length = items.length.toString().length
			return items.map((item, index) => ({
				...item,
				sortText: index.toString().padStart(length, "0")
			}))
		}
		catch (error) {
			console.log(error)
			return null
		}
	}

	protected abstract getCompletion(document: TDocument, position: VDFPosition, files: CompletionFiles, conditionals: (text?: string) => CompletionItem[]): Promise<CompletionItem[] | null>

	protected async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {
		const result = z.object({ image: z.object({ uri: Uri.schema, path: z.string() }) }).safeParse(item.data)

		if (result.success) {
			const { image } = result.data
			const uri = await this.VTFToPNG(image.uri, image.path)
			if (uri) {
				item.documentation = {
					kind: MarkupKind.Markdown,
					value: `![](${uri})`
				}
			}
		}

		return item
	}

	private async onDefinition(params: TextDocumentRequestParams<DefinitionParams>) {
		using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		for (const { type, key, value: ranges } of (function*() { yield* definitionReferences.references.collection; yield* definitionReferences.references.rest.get(document.uri.toString())?.collection ?? [] })()) {
			if (ranges.some((range) => range.contains(params.position))) {
				return definitionReferences.definitions.get(type, key)?.map((definition) => ({
					uri: definition.uri.toString(),
					range: definition.range
				})) ?? null
			}
		}
		return null
	}

	private async onReferences(params: TextDocumentRequestParams<ReferenceParams>) {
		using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		for (const { type, key, value: definitions } of definitionReferences.definitions) {
			if (definitions.some((definition) => definition.keyRange.contains(params.position))) {
				return definitionReferences
					.references
					.collect(type, key)
					.map(({ uri, range }) => ({ uri: uri.toString(), range: range }))
					.toArray()
			}
		}
		return null
	}

	private async onDocumentSymbol(params: TextDocumentRequestParams<DocumentSymbolParams>) {
		using document = await this.documents.get(params.textDocument.uri, true)
		return await firstValueFrom(document.documentSymbols$)
	}

	private async onCodeAction(params: TextDocumentRequestParams<CodeActionParams>): Promise<CodeAction[] | null> {

		using document = await this.documents.get(params.textDocument.uri)

		const diagnostics = this.documentDiagnostics.get(document)
		if (!diagnostics) {
			return null
		}

		const diagnosticDataSchema = z.object({ id: z.string().uuid() })

		const uri = params.textDocument.uri.toString()

		const utils = {
			createDocumentWorkspaceEdit: (range: VDFRange, newText: string) => ({
				changes: {
					[uri]: [
						TextEdit.replace(range, newText)
					]
				}
			}),
			findBestMatch: (mainString: string, targetStrings: string[]) => {
				return targetStrings.length != 0
					? findBestMatch(mainString, targetStrings).bestMatch.target
					: null
			}
		}

		const codeActions = params
			.context
			.diagnostics
			.values()
			.map((diagnostic) => {
				const result = diagnosticDataSchema.safeParse(diagnostic.data)
				if (!result.success) {
					return null
				}

				const diagnosticCodeAction = diagnostics.get(result.data.id)
				if (!diagnosticCodeAction) {
					return null
				}

				if (!diagnosticCodeAction.data) {
					return null
				}

				return {
					diagnostic: diagnostic,
					data: diagnosticCodeAction.data
				}
			})
			.filter(
				params.context.only
					? (value): value is NonNullable<typeof value> => value != null && params.context.only!.includes(value.data.kind)
					: (value): value is NonNullable<typeof value> => value != null
			)
			.map(({ diagnostic, data }, index) => {

				const codeAction = data.fix(utils)
				if (!codeAction) {
					return null
				}

				return {
					...codeAction,
					kind: data.kind,
					diagnostics: [diagnostic],
					isPreferred: index == 0
				} satisfies CodeAction
			})
			.filter((codeAction) => codeAction != null)
			.toArray()

		const codes = new Set(
			codeActions
				.values()
				.map((codeAction) => codeAction.diagnostics[0].code)
		)

		return [
			...codeActions,
			...codes
				.values()
				.map((code) => diagnostics.values().filter((diagnostic) => diagnostic.code == code).toArray())
				.filter((diagnostics) => diagnostics.length > 1)
				.map((diagnostics) => {
					return {
						title: `Fix all issues of kind '${diagnostics[0].message}'`,
						kind: CodeActionKind.QuickFix,
						diagnostics: diagnostics,
						edit: {
							changes: {
								[uri]: diagnostics
									.values()
									.flatMap((diagnostic) => diagnostic.data!.fix(utils)?.edit?.changes?.[uri] ?? [])
									.filter(edit => edit != undefined)
									.toArray()
							}
						}
					} satisfies CodeAction
				})
				.toArray()
		]
	}

	private async onCodeLens(params: TextDocumentRequestParams<CodeLensParams>) {
		using document = await this.documents.get(params.textDocument.uri)
		return await firstValueFrom(document.codeLens$)
	}

	protected abstract onDocumentFormatting(document: TDocument, params: TextDocumentRequestParams<DocumentFormattingParams>): Promise<TextEdit[]>

	private async onPrepareRename(params: TextDocumentRequestParams<PrepareRenameParams>) {

		using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)

		for (const { type, key, value: definitions } of definitionReferences.definitions) {
			for (const definition of definitions) {
				if (definition.uri.equals(params.textDocument.uri)) {
					if (definition.keyRange.contains(params.position)) {
						this.oldName = [type, key]
						return {
							range: definition.keyRange,
							placeholder: definition.key
						}
					}
					else if (definition.nameRange?.contains(params.position)) {
						this.oldName = [type, key]
						return {
							range: definition.nameRange,
							placeholder: definition.key
						}
					}
				}
			}
		}

		for (const { type, key, value: ranges } of definitionReferences.references.collection) {
			for (const range of ranges) {
				if (range.contains(params.position)) {
					this.oldName = [type, key]
					return {
						range: range,
						placeholder: definitionReferences.definitions.get(type, key)?.[0]?.key ?? key
					}
				}
			}
		}

		return null
	}

	private async onRenameRequest(params: TextDocumentRequestParams<RenameParams>) {

		if (this.oldName == null) {
			throw new Error(`this.oldName == null`)
		}

		using document = await this.documents.get(params.textDocument.uri)
		const [type, key] = this.oldName
		this.oldName = null
		return { changes: await this.rename(document, type, key, params.newName) }
	}

	protected abstract rename(document: TDocument, type: symbol, key: string, newName: string): Promise<Record<string, TextEdit[]>>
}
