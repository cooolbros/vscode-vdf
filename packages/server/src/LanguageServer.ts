import { createTRPCProxyClient, httpBatchLink, type CreateTRPCClientOptions, type CreateTRPCProxyClient } from "@trpc/client"
import { initTRPC, type AnyRouter, type CombinedDataTransformer } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import type { TRPCClientRouter } from "client/TRPCClientRouter"
import { devalueTransformer } from "common/devalueTransformer"
import { Uri } from "common/Uri"
import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { BehaviorSubject, concatMap, distinctUntilChanged, distinctUntilKeyChanged, finalize, firstValueFrom, from, Observable, of, shareReplay, Subject, Subscription, switchMap, zip } from "rxjs"
import { findBestMatch } from "string-similarity"
import { VDFPosition, VDFRange } from "vdf"
import { CodeAction, CodeActionKind, CodeLensRefreshRequest, CompletionItem, CompletionItemKind, Diagnostic, DidChangeConfigurationNotification, DocumentLink, DocumentSymbol, TextDocumentSyncKind, TextEdit, WorkspaceEdit, type CodeActionParams, type CodeLensParams, type CompletionParams, type Connection, type DefinitionParams, type DidSaveTextDocumentParams, type DocumentFormattingParams, type DocumentLinkParams, type DocumentSymbolParams, type GenericRequestHandler, type PrepareRenameParams, type ReferenceParams, type RenameParams, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { Definitions, References } from "./DefinitionReferences"
import type { HUDAnimationsLanguageServer } from "./HUDAnimations/HUDAnimationsLanguageServer"
import { TeamFortress2FileSystem } from "./TeamFortress2FileSystem"
import type { TextDocumentBase, TextDocumentInit } from "./TextDocumentBase"
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
		]
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
	capabilities: Omit<ServerCapabilities, keyof typeof capabilities>
	createDocument(init: TextDocumentInit, documentConfiguration$: Observable<VSCodeVDFConfiguration>): Promise<TDocument>
}

export type TextDocumentRequestParams<T extends { textDocument: { uri: string } }> = ({ textDocument: { uri: Uri } }) & Omit<T, "textDocument">

export type DiagnosticCodeAction = Omit<Diagnostic, "data"> & { data?: { kind: (typeof CodeActionKind)[keyof (typeof CodeActionKind)], fix: (createDocumentWorkspaceEdit: (range: VDFRange, newText: string) => WorkspaceEdit, findBestMatch: (mainString: string, targetStrings: string[]) => string | null) => Omit<CodeAction, "kind" | "diagnostic" | "isPreferred"> | null } }

export type CompletionFiles = (path: string, options: CompletionFilesOptions) => Promise<CompletionItem[]>

export interface CompletionFilesOptions {
	value: string | null
	extensionsPattern: `.${string}` | null
	displayExtensions: boolean
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
	protected readonly fileSystems: {
		get: (paths: (teamFortress2Folder: Uri) => ({ type: "folder" | "tf2" | "vpk" | "wildcard", uri: Uri } | null)[]) => Observable<TeamFortress2FileSystem>
	}
	protected readonly documents: TextDocuments<TDocument>

	private readonly observables = new Map<string, Observable<any>>()
	private readonly subscriptions = new Map<Observable<any>, Map<string, Subscription | null>>()
	private readonly subjects = new Map<string, WeakRef<Subject<unknown>>>()

	private readonly documentDiagnostics: WeakMap<TDocument, Map<string, DiagnosticCodeAction>>
	private readonly documentsLinks: WeakMap<TDocument, Map<string, (documentLink: DocumentLink) => Promise<Uri | null>>>

	private oldName: [symbol, string] | null = null

	protected readonly trpc: {
		client: CreateTRPCProxyClient<ReturnType<typeof TRPCClientRouter>>
		servers: {
			hudanimations: CreateTRPCProxyClient<ReturnType<HUDAnimationsLanguageServer["router"]>>
			popfile: CreateTRPCProxyClient<ReturnType<PopfileLanguageServer["router"]>>
			vgui: CreateTRPCProxyClient<ReturnType<VGUILanguageServer["router"]>>
			vmt: CreateTRPCProxyClient<ReturnType<VMTLanguageServer["router"]>>
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

		const teamFortress2Folder$ = onDidChangeConfiguration$.pipe(
			// concatMap(async () => {
			// 	await this.ready
			// }),
			concatMap(async () => {
				return VSCodeVDFConfigurationSchema.shape.teamFortress2Folder.parse(await this.connection.workspace.getConfiguration({ section: "vscode-vdf.teamFortress2Folder" }))
			}),
			distinctUntilChanged(),
			shareReplay(1)
		)

		const fileSystems = new Map<string, Observable<TeamFortress2FileSystem>>()
		this.fileSystems = {
			get: (paths) => {
				return teamFortress2Folder$.pipe(
					concatMap(async (teamFortress2Folder) => {
						return await this.trpc.client.teamFortress2FileSystem.open.mutate({
							paths: paths(teamFortress2Folder).filter((path) => path != null)
						})
					}),
					distinctUntilKeyChanged("key"),
					switchMap(({ key, paths }) => {
						let fileSystem$ = fileSystems.get(key)
						if (!fileSystem$) {
							fileSystem$ = of(
								new TeamFortress2FileSystem(paths.map((path) => path.uri), {
									resolveFile: (path) => {
										return from(this.trpc.client.teamFortress2FileSystem.resolveFile.query({ key, path }))
									},
									readDirectory: async (path, options) => {
										return await this.trpc.client.teamFortress2FileSystem.readDirectory.query({ key, path, options })
									}
								})
							).pipe(
								finalize(() => {
									console.log(`TeamFortress2FileSystem.finalize ${key}`)
									// fileSystems.delete(key)
									// this.trpc.client.teamFortress2FileSystem.dispose.mutate({ key })
								}),
								shareReplay({
									bufferSize: 1,
									refCount: true,
								})
							)

							fileSystems.set(key, fileSystem$)
						}
						return fileSystem$
					}),
					shareReplay(1)
				)
			},
		}

		this.connection.onDidChangeConfiguration((params) => {
			onDidChangeConfiguration$.next()
		})

		this.documents = new TextDocuments({
			open: async (uri) => {
				return await this.trpc.client.workspace.openTextDocument.query({ uri, languageId: languageId })
			},
			create: async (init) => {
				return languageServerConfiguration.createDocument(init, onDidChangeConfiguration$.pipe(
					concatMap(async () => {
						return VSCodeVDFConfigurationSchema.parse(await this.connection.workspace.getConfiguration({ scopeUri: init.uri.toString(), section: "vscode-vdf" }))
					}),
					shareReplay(1)
				))
			},
			onDidOpen: async (event) => {
				const subscriptions: { unsubscribe(): void }[] = []

				subscriptions.push(
					event.document.documentConfiguration$.pipe(
						distinctUntilKeyChanged("updateDiagnosticsEvent"),
						switchMap(({ updateDiagnosticsEvent }) => {
							return updateDiagnosticsEvent == "type"
								? event.document.diagnostics$
								: new Subject<DiagnosticCodeAction[]>()
						})
					).subscribe((diagnostics) => {
						const uri = event.document.uri.toString()

						const result: Diagnostic[] = []
						const map = new Map<string, DiagnosticCodeAction>()

						for (const diagnostic of diagnostics) {
							const id = crypto.randomUUID()
							const { data, ...rest } = diagnostic
							map.set(id, diagnostic)
							result.push({ ...rest, data: { id } })
						}

						this.documentDiagnostics.set(event.document, map)

						this.connection.sendDiagnostics({
							uri: uri,
							diagnostics: result
						})
					})
				)

				subscriptions.push(
					event.document.definitionReferences$.pipe(
						switchMap((definitionReferences) => definitionReferences.references$)
					).subscribe(() => {
						this.connection.sendRequest(CodeLensRefreshRequest.method)
					})
				)

				const { onDidClose } = await this.onDidOpen(event)

				return () => {
					this.connection.sendDiagnostics({
						uri: event.document.uri.toString(),
						diagnostics: []
					})

					onDidClose()

					for (const subscription of subscriptions) {
						subscription.unsubscribe()
					}

					this.documentDiagnostics.delete(event.document)
					this.documentsLinks.delete(event.document)
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
		this.onTextDocumentRequest(this.connection.onDefinition, this.onDefinition)
		this.onTextDocumentRequest(this.connection.onReferences, this.onReferences)
		this.onTextDocumentRequest(this.connection.onDocumentSymbol, this.onDocumentSymbol)
		this.onTextDocumentRequest(this.connection.onCodeAction, this.onCodeAction)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(
			this.connection.onDocumentFormatting,
			async (params: TextDocumentRequestParams<DocumentFormattingParams>) => {
				try {
					return await this.onDocumentFormatting(await this.documents.get(params.textDocument.uri), params)
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

		let _router: AnyRouter

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
					return await this.connection.sendRequest("vscode-vdf/sendRequest", { server, method, param })
				}
				else {
					return await this.connection.sendRequest(method, param)
				}
			},
			sendNotification: async (subscriber, method, param) => {
				await this.connection.sendNotification("vscode-vdf/sendNotification", { subscriber, method, param })
			},
		}) satisfies CombinedDataTransformer

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
			transformer: transformer,
			links: [
				httpBatchLink({
					url: "",
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
		} satisfies CreateTRPCClientOptions<AnyRouter>)

		this.trpc = {
			client: createTRPCProxyClient<ReturnType<typeof TRPCClientRouter>>(VSCodeRPCOptions(null)),
			servers: {
				hudanimations: createTRPCProxyClient<ReturnType<HUDAnimationsLanguageServer["router"]>>(VSCodeRPCOptions("hudanimations")),
				popfile: createTRPCProxyClient<ReturnType<PopfileLanguageServer["router"]>>(VSCodeRPCOptions("popfile")),
				vgui: createTRPCProxyClient<ReturnType<VGUILanguageServer["router"]>>(VSCodeRPCOptions("vdf")),
				vmt: createTRPCProxyClient<ReturnType<VMTLanguageServer["router"]>>(VSCodeRPCOptions("vmt")),
			}
		}

		this.documents.listen(this.connection)
		this.connection.listen()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.router({
			textDocument: t.router({
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
						const document = await this.documents.get(input.textDocument.uri, true)
						return await this.rename(document, input.oldName.type, input.oldName.key, input.newName)
					})
			}),
			observable: t.router({
				subscribe: t
					.procedure
					.input(
						z.object({
							serverId: z.enum([
								"hudanimations",
								"popfile",
								"vgui",
								"vmt",
							]),
							id: z.string()
						})
					)
					.mutation(({ input }) => {
						const observable = this.observables.get(input.id)!

						let servers = this.subscriptions.get(observable)
						if (!servers) {
							servers = new Map()
							this.subscriptions.set(observable, servers)
						}

						let subscription = servers.get(input.serverId)
						if (!subscription) {
							subscription = observable.subscribe((value) => {
								this.trpc.servers[input.serverId].observable.next.mutate({
									id: input.id,
									value: value
								})
							})
							servers.set(input.serverId, subscription)
						}
					}),
				next: t
					.procedure
					.input(
						z.object({
							id: z.string(),
							value: z.any()
						})
					)
					.mutation(({ input }) => {
						// this.next(input.id, input.value)
					}),
				unsubscribe: t
					.procedure
					.input(
						z.object({
							serverId: z.enum([
								"hudanimations",
								"popfile",
								"vgui",
								"vmt",
							]),
							id: z.string()
						})
					)
					.mutation(({ input }) => {
						const observable = this.observables.get(input.id)!
						const servers = this.subscriptions.get(observable)
						if (servers) {
							servers.get(input.serverId)?.unsubscribe()
							servers.set(input.serverId, null)
						}
					}),
				free: t
					.procedure
					.input(
						z.object({
							serverId: z.enum([
								"hudanimations",
								"popfile",
								"vgui",
								"vmt",
							]),
							id: z.string()
						})
					)
					.mutation(({ input }) => {
						const observable = this.observables.get(input.id)
						if (observable) {
							const servers = this.subscriptions.get(observable)
							if (servers) {
								const subscription = servers.get(input.serverId)
								if (subscription != undefined && subscription != null) {
									throw new Error(`Cannot free observable "${input.id}" with ${input.serverId} active subscription`)
								}

								servers.delete(input.serverId)
								if (servers.size == 0) {
									this.observables.delete(input.id)
									this.subscriptions.delete(observable)
								}
							}
						}
					})
			})
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

	protected async onDidOpen(event: TextDocumentChangeEvent<TDocument>): Promise<{ onDidClose: () => void }> {
		return {
			onDidClose: () => {
				this.documentDiagnostics.delete(event.document)
				this.documentsLinks.delete(event.document)
			}
		}
	}

	protected async onDidSaveTextDocument(params: TextDocumentRequestParams<DidSaveTextDocumentParams>) {
		const document = await this.documents.get(params.textDocument.uri)
		const documentConfiguration = await firstValueFrom(document.documentConfiguration$)

		if (documentConfiguration.updateDiagnosticsEvent == "save") {
			const diagnostics = await firstValueFrom(document.diagnostics$)
			this.connection.sendDiagnostics({
				uri: params.textDocument.uri.toString(),
				diagnostics: diagnostics
			})
		}
	}

	private async onDocumentLinks(params: TextDocumentRequestParams<DocumentLinkParams>) {

		const document = await this.documents.get(params.textDocument.uri)
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
		const document = await this.documents.get(uri)

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
			const document = await this.documents.get(params.textDocument.uri)
			return await this.getCompletion(
				document,
				new VDFPosition(params.position.line, params.position.character),
				async (path: string, { value, extensionsPattern, displayExtensions }: CompletionFilesOptions) => {
					return await firstValueFrom(
						zip([document.fileSystem$, document.documentConfiguration$]).pipe(
							concatMap(async ([fileSystem, documentConfiguration]) => {

								let startsWithFilter: ((name: string, type: number) => boolean) | null = null

								if (value) {
									const [last, ...rest] = value.split("/").reverse()
									if (rest.length) {
										path += `/${rest.reverse().join("/")}`
									}
									startsWithFilter = (name: string, type: number) => name.toLowerCase().startsWith(last)
								}

								const entries = await fileSystem.readDirectory(path, {
									recursive: documentConfiguration.filesAutoCompletionKind == "all",
									pattern: extensionsPattern != null
										? `**/*.${extensionsPattern}`
										: undefined
								})

								const incremental = documentConfiguration.filesAutoCompletionKind == "incremental"

								const filters = [
									!incremental ? (name: string, type: number) => type == 1 : null, // Hide folders when filesAutoCompletionKind is "all", because the user will not #base a folder
									startsWithFilter,
								].filter((f) => f != null)

								const filter = ([name, type]: [string, number]) => filters.every((filter) => filter(name, type))

								return entries
									.values()
									.filter(filter)
									.map(([name, type]): CompletionItem => ({
										label: name,
										kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
										...(incremental && {
											commitCharacters: ["/"],
										})
									}))
									.toArray()
							})
						)
					)
				}
			)
		}
		catch (error) {
			console.log(error)
			return null
		}
	}

	protected abstract getCompletion(document: TDocument, position: VDFPosition, files: CompletionFiles): Promise<CompletionItem[] | null>

	private async onDefinition(params: TextDocumentRequestParams<DefinitionParams>) {
		const definitionReferences = await firstValueFrom((await this.documents.get(params.textDocument.uri)).definitionReferences$)
		for (const { type, key, value: ranges } of definitionReferences.references.get(params.textDocument.uri.toString()) ?? []) {
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
		const definitionReferences = await firstValueFrom((await this.documents.get(params.textDocument.uri)).definitionReferences$)
		for (const { type, key, value: definitions } of definitionReferences.definitions) {
			if (definitions.some((definition) => definition.keyRange.contains(params.position))) {
				return definitionReferences
					.references
					.values()
					.flatMap((references) => references.get(type, key).map((range) => ({ uri: references.uri.toString(), range })))
					.toArray()
			}
		}
		return null
	}

	private async onDocumentSymbol(params: TextDocumentRequestParams<DocumentSymbolParams>) {
		return await firstValueFrom((await this.documents.get(params.textDocument.uri, true)).documentSymbols$)
	}

	private async onCodeAction(params: TextDocumentRequestParams<CodeActionParams>): Promise<CodeAction[] | null> {

		const document = await this.documents.get(params.textDocument.uri)

		const diagnostics = this.documentDiagnostics.get(document)
		if (!diagnostics) {
			return null
		}

		const filter = params.context.only
			? (diagnostic: DiagnosticCodeAction) => params.context.only!.includes(diagnostic.data!.kind)
			: () => true

		const uri = params.textDocument.uri.toString()

		return params
			.context
			.diagnostics
			.values()
			.map((diagnostic) => diagnostics.get(diagnostic.data.id))
			.filter((diagnostic): diagnostic is NonNullable<typeof diagnostic> => diagnostic != undefined && diagnostic.data != undefined)
			.filter(filter)
			.map((diagnostic) => {
				let isPreferred = true

				const codeAction = diagnostic.data!.fix(
					(range: VDFRange, newText: string) => {
						return {
							changes: {
								[uri]: [
									TextEdit.replace(range, newText)
								]
							}
						}
					},
					(mainString: string, targetStrings: string[]) => {
						if (!targetStrings.length) {
							return null
						}
						const match = findBestMatch(mainString, targetStrings).bestMatch
						// isPreferred = match.rating > 0.5
						return match.target
					}
				)

				if (!codeAction) {
					return null
				}

				return {
					...codeAction,
					kind: diagnostic.data!.kind,
					diagnostics: [diagnostic],
					isPreferred: isPreferred
				} satisfies CodeAction
			})
			.filter((codeAction) => codeAction != null)
			.toArray()
	}

	private async onCodeLens(params: TextDocumentRequestParams<CodeLensParams>) {
		return await firstValueFrom((await this.documents.get(params.textDocument.uri)).codeLens$)
	}

	protected abstract onDocumentFormatting(document: TDocument, params: TextDocumentRequestParams<DocumentFormattingParams>): Promise<TextEdit[]>

	private async onPrepareRename(params: TextDocumentRequestParams<PrepareRenameParams>) {

		const definitionReferences = await firstValueFrom((await this.documents.get(params.textDocument.uri)).definitionReferences$)

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

		for (const { type, key, value: ranges } of definitionReferences.references.get(params.textDocument.uri.toString()) ?? []) {
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

		const document = await this.documents.get(params.textDocument.uri)
		const [type, key] = this.oldName
		this.oldName = null
		return { changes: await this.rename(document, type, key, params.newName) }
	}

	protected abstract rename(document: TDocument, type: symbol, key: string, newName: string): Promise<Record<string, TextEdit[]>>
}
