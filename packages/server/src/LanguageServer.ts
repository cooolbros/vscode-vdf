import { createTRPCClient, type CreateTRPCClientOptions, type TRPCClient } from "@trpc/client"
import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { initTRPC, type AnyTRPCRouter } from "@trpc/server"
import type { TRPCClientRouter } from "client/TRPCClientRouter"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemKey } from "common/FileSystemKey"
import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import { Uri } from "common/Uri"
import { VSCodeJSONRPCLink } from "common/VSCodeJSONRPCLink"
import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { BehaviorSubject, combineLatest, concatMap, distinctUntilChanged, distinctUntilKeyChanged, EMPTY, finalize, firstValueFrom, Observable, shareReplay, switchMap } from "rxjs"
import { findBestMatch } from "string-similarity"
import { VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import vscode from "vscode"
import { CodeAction, CodeActionKind, CodeLensRefreshRequest, Color, CompletionItem, CompletionItemKind, Diagnostic, DidChangeConfigurationNotification, DocumentLink, DocumentSymbol, Hover, InlayHint, InlayHintRequest, MarkupKind, TextDocumentSyncKind, TextEdit, type CodeActionParams, type CodeLensParams, type ColorPresentationParams, type CompletionParams, type Connection, type DefinitionParams, type DidSaveTextDocumentParams, type DocumentColorParams, type DocumentFormattingParams, type DocumentLinkParams, type DocumentSymbolParams, type GenericRequestHandler, type HoverParams, type InlayHintParams, type PrepareRenameParams, type ReferenceParams, type RenameParams, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { version } from "../../../package.json"
import { Definitions, References } from "./DefinitionReferences"
import type { HUDAnimationsLanguageServer } from "./HUDAnimations/HUDAnimationsLanguageServer"
import { TextDocumentBase, type ColourInformationStringify, type DiagnosticCodeAction, type DocumentLinkData, type TextDocumentInit } from "./TextDocumentBase"
import type { PopfileLanguageServer } from "./VDF/Popfile/PopfileLanguageServer"
import type { VGUILanguageServer } from "./VDF/VGUI/VGUILanguageServer"
import type { VMTLanguageServer } from "./VDF/VMT/VMTLanguageServer"
import type { WorkspaceBase } from "./WorkspaceBase"

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
	hoverProvider: true,
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
	colorProvider: true,
	inlayHintProvider: true,
	documentFormattingProvider: true,
	renameProvider: {
		prepareProvider: true
	}
} satisfies ServerCapabilities

export interface LanguageServerConfiguration<TDocument extends TextDocumentBase<TDocumentSymbols, TDependencies>, TDocumentSymbols extends DocumentSymbol[], TDependencies, TWorkspace extends WorkspaceBase> {
	platform: string,
	servers: Set<VSCodeVDFLanguageID>
	/**
	 * https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
	 */
	capabilities: Omit<ServerCapabilities, keyof typeof capabilities>
	createDocument(init: TextDocumentInit, documentConfiguration$: Observable<VSCodeVDFConfiguration>): Promise<TDocument>
	createWorkspace(uri: Uri): Promise<TWorkspace>
}

export type TextDocumentRequestParams<T extends { textDocument: { uri: string } }> = ({ textDocument: { uri: Uri } }) & Omit<T, "textDocument">

export abstract class LanguageServer<
	TLanguageId extends VSCodeVDFLanguageID,
	TDocument extends TextDocumentBase<TDocumentSymbols, TDependencies>,
	TDocumentSymbols extends DocumentSymbol[],
	TDependencies,
	TWorkspace extends WorkspaceBase
> extends AsyncDisposableBase {

	protected readonly languageId: TLanguageId
	protected readonly connection: Connection
	protected readonly languageServerConfiguration: LanguageServerConfiguration<TDocument, TDocumentSymbols, TDependencies, TWorkspace>
	protected readonly workspaceUris: PromiseWithResolvers<{ teamFortress2Folder: Uri, workspaceUris: Uri[] }>

	protected readonly fileSystems: RefCountAsyncDisposableFactory<FileSystemKey[], FileSystemMountPoint>
	protected readonly workspaces: { get: (uri: Uri, factory?: (uri: Uri) => Promise<TWorkspace>) => Promise<TWorkspace> }
	protected readonly documents: RefCountAsyncDisposableFactory<Uri, TDocument>

	private readonly diagnostic = { id: 0 }
	private readonly documentDiagnostics: Map<string, Map<number, DiagnosticCodeAction>>
	private readonly documentsLinks: Map<string, { document: TDocument, promise: Promise<(Omit<DocumentLinkData, "data"> & { data: DocumentLinkData["data"] & { uri: Uri, index: number } })[]> }>
	private readonly documentsColours: Map<string, { version: number, promise: Promise<{ colours: ColourInformationStringify[], map: Map<string, (colour: Color) => string> }> }>
	private readonly documentsInlayHints: Map<string, { version: number, promise: Promise<InlayHint[]> }>

	private oldName: [number | null, symbol, string] | null = null

	public readonly trpc: {
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
		languageServerConfiguration: LanguageServerConfiguration<TDocument, TDocumentSymbols, TDependencies, TWorkspace>,
	) {
		super()
		this.languageId = languageId
		this.connection = connection
		this.languageServerConfiguration = languageServerConfiguration
		this.workspaceUris = Promise.withResolvers()

		this.connection.onExit(async () => await this[Symbol.asyncDispose]())

		const transformer = devalueTransformer({
			reducers: {
				Definitions: (value: unknown) => value instanceof Definitions && value.toJSON(),
				References: (value: unknown) => value instanceof References && value.toJSON(),
				Symbol: (value: unknown) => typeof value == "symbol" ? Symbol.keyFor(value) : undefined,
				Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
				VDFDocumentSymbol: (value: unknown) => value instanceof VDFDocumentSymbol ? value.toJSON() : undefined,
				VDFDocumentSymbols: (value: unknown) => value instanceof VDFDocumentSymbols ? value.toJSON() : undefined,
				VDFPosition: (value: unknown) => value instanceof VDFPosition ? value.toJSON() : undefined,
				VDFRange: (value: unknown) => value instanceof VDFRange ? value.toJSON() : undefined,
			},
			revivers: {
				Definitions: (value: ReturnType<Definitions["toJSON"]>) => Definitions.schema.parse(value),
				References: (value: ReturnType<References["toJSON"]>) => References.schema.parse(value),
				Symbol: (value: ReturnType<Symbol["toString"]>) => Symbol.for(value),
				Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
				VDFDocumentSymbol: (value: ReturnType<VDFDocumentSymbol["toJSON"]>) => VDFDocumentSymbol.schema.parse(value),
				VDFDocumentSymbols: (value: ReturnType<VDFDocumentSymbols["toJSON"]>) => VDFDocumentSymbols.schema.parse(value),
				VDFPosition: (value: ReturnType<VDFPosition["toJSON"]>) => VDFPosition.schema.parse(value),
				VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
			}
		})

		const start = Promise.withResolvers<VSCodeVDFLanguageID[] | undefined>()

		this.connection.onRequest("vscode-vdf/trpc", TRPCRequestHandler({
			router: this.router(
				initTRPC
					.context<{ client: VSCodeVDFLanguageID }>()
					.create({
						transformer: transformer,
						isDev: true,
					})
			),
			schema: VSCodeVDFLanguageIDSchema,
			stack: this.stack,
			sendNotification: async (server, method, param) => {
				return await this.connection.sendNotification("vscode-vdf/sendNotification", { server, method, param: { server: this.languageId, notification: param } })
			},
			start: start.promise,
			onExit: async (clients) => {
				await this.connection.sendNotification("vscode-vdf/exit", { clients: [...clients] })
			},
		}))

		const notificationSchema = z.object({
			server: VSCodeVDFLanguageIDSchema.nullable(),
			notification: z.unknown(),
		})

		const notificationHandlers = new Map<z.infer<typeof notificationSchema.shape.server>, (param: unknown) => Promise<void>>()

		this.connection.onNotification("vscode-vdf/trpc", async (param) => {
			const { server, notification } = notificationSchema.parse(param)
			await notificationHandlers.get(server)!(notification)
		})

		const VSCodeRPCOptions = (server: VSCodeVDFLanguageID | null) => ({
			links: [
				VSCodeJSONRPCLink({
					stack: this.stack,
					client: { name: this.languageId },
					transformer: transformer,
					onNotification: (type, handler) => {
						notificationHandlers.set(server, handler)
						return { [Symbol.dispose]: () => notificationHandlers.delete(server) }
					},
					sendRequest: server != null
						? async (method, param) => await this.connection.sendRequest("vscode-vdf/sendRequest", { server, method, param })
						: async (method, param) => await this.connection.sendRequest(method, param)
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

		const onDidChangeConfiguration$ = new BehaviorSubject<void>(undefined)

		this.fileSystems = new RefCountAsyncDisposableFactory(
			(paths) => JSON.stringify(paths),
			async (paths, factory) => {
				const { key } = await this.trpc.client.teamFortress2FileSystem.open.mutate({ paths })
				const files = new Map<string, Observable<Entry>>()
				const directories = new Map<string, Observable<[string, vscode.FileType][]>>()
				return {
					resolve: (path) => {
						return files.getOrInsertComputed(path, () => {
							return fromTRPCSubscription(this.trpc.client.teamFortress2FileSystem.resolve, { key, path }).pipe(
								distinctUntilChanged((a, b) => a.type == b.type && Uri.equals(a.uri, b.uri)),
								finalize(() => files.delete(path)),
								shareReplay({ bufferSize: 1, refCount: true })
							)
						})
					},
					readDirectory: async (path, options) => {
						return await this.trpc.client.teamFortress2FileSystem.readDirectory.query({ key, path, options })
					},
					watchDirectory: (path, options) => {
						const directoryKey = JSON.stringify({ path, options })
						return directories.getOrInsertComputed(directoryKey, () => {
							return fromTRPCSubscription(this.trpc.client.teamFortress2FileSystem.watchDirectory, { key, path, options }).pipe(
								finalize(() => directories.delete(directoryKey)),
								shareReplay({ bufferSize: 1, refCount: true })
							)
						})
					},
					[Symbol.asyncDispose]: async () => {
						await this.trpc.client.teamFortress2FileSystem.dispose.mutate({ key })
					}
				}
			}
		)

		const workspaces = new Map<string, Promise<TWorkspace>>()
		this.stack.defer(async () => {
			await Promise.all(workspaces.values().map(async (promise) => (await promise)[Symbol.asyncDispose]()))
		})

		this.workspaces = {
			get: async (uri: Uri, factory = this.languageServerConfiguration.createWorkspace) => {
				const workspace = await workspaces.getOrInsertComputed(uri.toString(), async () => await factory(uri))
				return new Proxy(workspace, {
					get(target, p, receiver) {
						return p == Symbol.asyncDispose
							? async () => { console.warn(`${target.constructor.name} [Symbol.asyncDispose]()`) }
							: Reflect.get(target, p, receiver)
					},
				})
			}
		}

		this.documents = new RefCountAsyncDisposableFactory(
			(uri) => uri.toString(),
			async (uri) => await languageServerConfiguration.createDocument(
				await this.trpc.client.workspace.openTextDocument.query({ uri, languageId: languageId }),
				onDidChangeConfiguration$.pipe(
					concatMap(async () => VSCodeVDFConfigurationSchema.parse(await this.connection.workspace.getConfiguration({ scopeUri: uri.toString(), section: "vscode-vdf" }))),
					shareReplay({ bufferSize: 1, refCount: true })
				)
			)
		)

		this.connection.onDidChangeConfiguration((params) => {
			onDidChangeConfiguration$.next()
		})

		const onDidClose = new Map<string, Promise<AsyncDisposable>>()
		this.stack.defer(async () => {
			await Promise.all(onDidClose.values().map(async (promise) => (await promise)[Symbol.asyncDispose]()))
		})

		this.connection.onDidOpenTextDocument(async (params) => {

			const uri = new Uri(params.textDocument.uri)
			const key = uri.toString()

			const { promise, resolve } = Promise.withResolvers<AsyncDisposable>()
			onDidClose.set(key, promise)

			const stack = new AsyncDisposableStack()

			const document = stack.use(await this.documents.get(uri, async (uri) => await languageServerConfiguration.createDocument(
				{
					uri: uri,
					languageId: this.languageId,
					version: params.textDocument.version,
					content: params.textDocument.text,
				},
				onDidChangeConfiguration$.pipe(
					concatMap(async () => VSCodeVDFConfigurationSchema.parse(await this.connection.workspace.getConfiguration({ scopeUri: uri.toString(), section: "vscode-vdf" }))),
					shareReplay({ bufferSize: 1, refCount: true })
				)
			)))

			stack.use(await this.onDidOpen({ document }))

			stack.adopt(
				document.definitionReferences$.pipe(
					switchMap((definitionReferences) => definitionReferences.references.references$)
				).subscribe(() => this.connection.sendRequest(CodeLensRefreshRequest.method)),
				(subscription) => subscription.unsubscribe()
			)

			stack.adopt(
				document.documentConfiguration$.pipe(
					distinctUntilKeyChanged("updateDiagnosticsEvent"),
					switchMap(({ updateDiagnosticsEvent }) => {
						return updateDiagnosticsEvent == "type"
							? document.diagnostics$
							: EMPTY
					})
				).subscribe((diagnostics) => {
					this.sendDiagnostics(document, diagnostics)
				}),
				(subscription) => {
					this.sendDiagnostics(document, [])
					subscription.unsubscribe()
				}
			)

			resolve(stack.move())
		})

		this.connection.onDidChangeTextDocument(async (params) => {
			if (params.contentChanges.length != 0) {
				await using document = await this.documents.get(new Uri(params.textDocument.uri))
				document.update(params.contentChanges, params.textDocument.version)
			}
		})

		this.connection.onDidCloseTextDocument(async (params) => {
			const key = new Uri(params.textDocument.uri).toString()
			const disposable = onDidClose.get(key)
			onDidClose.delete(key)
			if (disposable) {
				(await disposable)[Symbol.asyncDispose]()
			}
		})

		this.documentDiagnostics = new Map()
		this.documentsLinks = new Map()
		this.documentsColours = new Map()
		this.documentsInlayHints = new Map()

		this.connection.onInitialize(async (params) => {
			this.connection.console.log(`${name} Language Server v${version}`)
			this.connection.console.log(languageServerConfiguration.platform)

			const initializationOptions = z.object({
				teamFortress2Folder: Uri.schema,
				clients: z.array(VSCodeVDFLanguageIDSchema).optional()
			}).parse(params.initializationOptions)

			this.workspaceUris.resolve({
				teamFortress2Folder: initializationOptions.teamFortress2Folder,
				workspaceUris: params.workspaceFolders?.map((workspaceFolder) => new Uri(workspaceFolder.uri)) ?? []
			})

			start.resolve(initializationOptions.clients)

			return {
				serverInfo: {
					name: `${name} Language Server`,
					version: version,
				},
				capabilities: {
					// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
					...languageServerConfiguration.capabilities,
					...capabilities,
				},
				data: {
					servers: [...this.languageServerConfiguration.servers],
				}
			}
		})

		this.connection.onInitialized(async (params) => {
			await this.connection.client.register(DidChangeConfigurationNotification.type)
		})

		this.onTextDocumentRequest(this.connection.onDidSaveTextDocument, this.onDidSaveTextDocument)
		this.onTextDocumentRequest(this.connection.onCompletion, this.onCompletion)
		this.connection.onCompletionResolve((item) => this.onCompletionResolve(item))
		this.onTextDocumentRequest(this.connection.onHover, this.onHover)
		this.onTextDocumentRequest(this.connection.onDefinition, this.onDefinition)
		this.onTextDocumentRequest(this.connection.onReferences, this.onReferences)
		this.onTextDocumentRequest(this.connection.onDocumentSymbol, this.onDocumentSymbol)
		this.onTextDocumentRequest(this.connection.onCodeAction, this.onCodeAction)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(
			this.connection.onDocumentFormatting,
			async (params: TextDocumentRequestParams<DocumentFormattingParams>) => {
				try {
					await using document = await this.documents.get(params.textDocument.uri)
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
		this.onTextDocumentRequest(this.connection.onDocumentColor, this.onDocumentColor)
		this.onTextDocumentRequest(this.connection.onColorPresentation, this.onColorPresentation)
		this.onTextDocumentRequest((handler: GenericRequestHandler<InlayHint[] | null, void>) => this.connection.onRequest(InlayHintRequest.method, handler), this.onInlayHint)
		this.onTextDocumentRequest(this.connection.onPrepareRename, this.onPrepareRename)
		this.onTextDocumentRequest(this.connection.onRenameRequest, this.onRenameRequest)

		this.connection.listen()
	}

	protected router(t: TRPCRootObject<{ client: VSCodeVDFLanguageID }, object, { transformer: DataTransformer }>) {
		return t.router({
			textDocument: {
				rename: t
					.procedure
					.input(
						z.object({
							textDocument: z.object({
								uri: Uri.schema
							}),
							oldName: z.object({
								scope: z.number().nullable(),
								type: z.symbol(),
								key: z.string(),
							}),
							newName: z.string(),
						})
					)
					.query(async ({ input }) => {
						await using document = await this.documents.get(input.textDocument.uri)
						return await this.rename(document, input.oldName.scope, input.oldName.type, input.oldName.key, input.newName)
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

	private async VTFToPNGBase64(uri: Uri, fileSystem: FileSystemMountPoint) {
		const baseTexture = await firstValueFrom(fromTRPCSubscription(this.trpc.servers.vmt.baseTexture, { uri }))
		if (!baseTexture) {
			return null
		}

		const vtf = await firstValueFrom(fileSystem.resolve(baseTexture.path))
		if (vtf.type != EntryType.File) {
			return null
		}

		return await this.trpc.client.VTFToPNGBase64.query({ uri: vtf.uri })
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<TDocument>): Promise<AsyncDisposable> {
		return {
			[Symbol.asyncDispose]: async () => {
				const uri = event.document.uri.toString()
				await this.documentsLinks.get(uri)?.document[Symbol.asyncDispose]()

				this.documentDiagnostics.delete(uri)
				this.documentsLinks.delete(uri)
				this.documentsColours.delete(uri)
				this.documentsInlayHints.delete(uri)
			}
		}
	}

	protected async onDidSaveTextDocument(params: TextDocumentRequestParams<DidSaveTextDocumentParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		const documentConfiguration = await firstValueFrom(document.documentConfiguration$)

		if (documentConfiguration.updateDiagnosticsEvent == "save") {
			const diagnostics = await firstValueFrom(document.diagnostics$)
			this.sendDiagnostics(document, diagnostics)
		}
	}

	protected sendDiagnostics(document: TDocument, diagnostics: DiagnosticCodeAction[]) {

		const result: Diagnostic[] = []
		const map = new Map<number, DiagnosticCodeAction>()

		for (const diagnostic of diagnostics) {
			const id = this.diagnostic.id++
			const { data, ...rest } = diagnostic
			map.set(id, diagnostic)
			result.push({ ...rest, data: { id } })
		}

		this.documentDiagnostics.set(document.uri.toString(), map)

		this.connection.sendDiagnostics({
			uri: document.uri.toString(),
			diagnostics: result
		})
	}

	private async onDocumentLinks(params: TextDocumentRequestParams<DocumentLinkParams>) {
		const document = await this.documents.get(params.textDocument.uri)
		const uri = document.uri.toString()

		let documentLinks = this.documentsLinks.get(uri)
		if (documentLinks?.document.version == document.version) {
			await document[Symbol.asyncDispose]()
			return await documentLinks.promise
		}

		await documentLinks?.document[Symbol.asyncDispose]()

		documentLinks = {
			document: document,
			promise: document.getLinks().then((documentLinks) => {
				return documentLinks.map((documentLink, index): (Omit<DocumentLinkData, "data"> & { data: DocumentLinkData["data"] & { uri: Uri, index: number } }) => {
					// @ts-expect-error
					documentLink.data.uri = document.uri
					// @ts-expect-error
					documentLink.data.index = index
					return documentLink as any
				})
			})
		}

		this.documentsLinks.set(uri, documentLinks)
		return await documentLinks.promise
	}

	private async onDocumentLinkResolve(documentLink: DocumentLink) {

		const { uri, index } = z.object({ uri: Uri.schema, index: z.number().nonnegative() }).parse(documentLink.data)

		const resolve = (await this.documentsLinks.get(uri.toString())?.promise)?.[index].data.resolve
		if (resolve == undefined) {
			// Document closed
			// https://github.com/cooolbros/vscode-vdf/issues/10
			return documentLink
		}

		documentLink.target = (await resolve())?.toString()
		console.log(documentLink.target)
		return documentLink
	}

	private async onDocumentColor(params: TextDocumentRequestParams<DocumentColorParams>) {

		await using document = await this.documents.get(params.textDocument.uri)

		let documentColours = this.documentsColours.get(document.uri.toString())
		if (documentColours?.version == document.version) {
			return (await documentColours.promise).colours
		}

		documentColours = {
			version: document.version,
			promise: document.getColours().then((colours) => {
				const map = new Map(colours.values().map(({ range, stringify }) => [`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`, stringify]))
				return {
					colours,
					map,
				}
			})
		}

		this.documentsColours.set(document.uri.toString(), documentColours)
		return (await documentColours.promise).colours
	}

	private async onColorPresentation(params: TextDocumentRequestParams<ColorPresentationParams>) {
		const { color: colour, range } = params

		const stringify = (await this.documentsColours.get(params.textDocument.uri.toString())?.promise)?.map.get(`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`)
		if (stringify == undefined) {
			return null
		}

		return [{ label: stringify(colour) }]
	}

	private async onInlayHint(params: TextDocumentRequestParams<InlayHintParams>) {

		await using document = await this.documents.get(params.textDocument.uri)
		const uri = document.uri.toString()

		let documentInlayHints = this.documentsInlayHints.get(uri)
		if (documentInlayHints?.version == document.version) {
			return await documentInlayHints.promise
		}

		documentInlayHints = {
			version: document.version,
			promise: document.getInlayHints()
		}

		this.documentsInlayHints.set(uri, documentInlayHints)
		return await documentInlayHints.promise
	}

	private async onCompletion(params: TextDocumentRequestParams<CompletionParams>) {
		try {
			await using document = await this.documents.get(params.textDocument.uri)
			const configuration = await firstValueFrom(document.documentConfiguration$)
			if (!configuration[this.languageId].suggest.enable) {
				return null
			}

			const position = new VDFPosition(params.position.line, params.position.character)

			const items = await this.getCompletion(
				document,
				position,
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
			return items.map((item, index) => {
				return {
					...item,
					sortText: index.toString().padStart(length, "0"),
				} satisfies CompletionItem
			})
		}
		catch (error) {
			console.log(error)
			return null
		}
	}

	protected abstract getCompletion(document: TDocument, position: VDFPosition, conditionals: (text?: string) => CompletionItem[]): Promise<CompletionItem[] | null>

	protected async onCompletionResolve(item: CompletionItem): Promise<CompletionItem> {

		const quote = (string: string) => {
			if (string.length == 0 || /\s/.test(string)) {
				return true
			}

			const trimmed = string.trim()
			const start = trimmed.startsWith("{") || trimmed.startsWith("}") || trimmed.startsWith("[") || trimmed.startsWith("//")
			const end = trimmed.endsWith("{") || trimmed.endsWith("}") || trimmed.endsWith("\"")
			return start || end
		}

		const text = item.insertText ?? item.label
		// item.insertText = quote(text) ? `"${text}"` : text

		const result = z.object({ image: z.object({ uri: Uri.schema, path: z.string() }) }).safeParse(item.data)

		if (result.success) {
			const { image } = result.data
			await using document = await this.documents.get(image.uri)
			const entry = await firstValueFrom(document.fileSystem.resolve(image.path))
			if (entry.type == EntryType.File) {
				const value = await this.VTFToPNGBase64(entry.uri, document.fileSystem)
				if (value) {
					item.documentation = {
						kind: MarkupKind.Markdown,
						value: value + "\n\n" + (typeof item.documentation == "string" ? item.documentation : item.documentation?.value ?? "")
					}
				}
			}
		}

		return item
	}

	private async onHover(params: TextDocumentRequestParams<HoverParams>): Promise<Hover | null> {
		await using document = await this.documents.get(params.textDocument.uri)
		const uri = document.uri.toString()

		const { definitionReferences, documentLinks } = await firstValueFrom(combineLatest({
			definitionReferences: document.definitionReferences$,
			documentLinks: this.documentsLinks.get(uri)!.promise
		}))

		for (const { value: definitions } of definitionReferences.definitions) {
			for (const definition of definitions) {
				if (Uri.equals(definition.uri, params.textDocument.uri) && (definition.keyRange.contains(params.position) || definition.nameRange?.contains(params.position))) {
					return {
						contents: definitions.map((definition) => definition.documentation).join("\n\n"),
						range: [definition.keyRange, definition.nameRange].find((range) => range?.contains(params.position))!
					}
				}
			}
		}

		for (const { scope, type, key, value: ranges } of definitionReferences.references.document()) {
			for (const range of ranges) {
				if (range.contains(params.position)) {
					const definitions = definitionReferences.definitions.get(scope, type, key)
					if (definitions?.length) {
						return {
							contents: definitions.map((definition) => definition.documentation).join("\n\n"),
							range: range
						}
					}
				}
			}
		}

		for (const { range, data } of documentLinks) {
			if (range.contains(params.position)) {
				const target = await data.resolve()
				if (target != null && target.extname() == ".vmt") {
					const value = await this.VTFToPNGBase64(target, document.fileSystem)
					if (value) {
						return {
							contents: value,
							range: range
						}
					}
				}

				return null
			}
		}

		return null
	}

	private async onDefinition(params: TextDocumentRequestParams<DefinitionParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		for (const { scope, type, key, value: ranges } of definitionReferences.references.document()) {
			if (ranges.some((range) => range.contains(params.position))) {
				return definitionReferences.definitions.get(scope, type, key)?.map((definition) => ({
					uri: definition.uri.toString(),
					range: definition.range
				})) ?? null
			}
		}
		return null
	}

	private async onReferences(params: TextDocumentRequestParams<ReferenceParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		for (const { scope, type, key, value: definitions } of definitionReferences.definitions) {
			if (definitions.some((definition) => definition.keyRange.contains(params.position))) {
				return definitionReferences
					.references
					.collect(scope, type, key)
					.map(({ uri, range }) => ({ uri: uri.toString(), range: range }))
					.toArray()
			}
		}
		return null
	}

	private async onDocumentSymbol(params: TextDocumentRequestParams<DocumentSymbolParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		return await firstValueFrom(document.documentSymbols$)
	}

	private async onCodeAction(params: TextDocumentRequestParams<CodeActionParams>): Promise<CodeAction[] | null> {

		await using document = await this.documents.get(params.textDocument.uri)
		const uri = document.uri.toString()

		const diagnostics = this.documentDiagnostics.get(uri)
		if (!diagnostics) {
			return null
		}

		const diagnosticDataSchema = z.object({ id: z.number() })

		const utils = {
			params: params,
			createDocumentWorkspaceEdit: (edit: TextEdit) => ({ changes: { [uri]: [edit] } }),
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
					? (value): value is NonNullable<typeof value> => value != null && params.context.only!.includes(CodeActionKind.QuickFix)
					: (value): value is NonNullable<typeof value> => value != null
			)
			.map(({ diagnostic, data }, index) => {

				const codeAction = data.fix(utils)
				if (!codeAction) {
					return null
				}

				return {
					...codeAction,
					kind: CodeActionKind.QuickFix,
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
				.filter((diagnostics) => diagnostics.length > 1 && diagnostics.every((diagnostic) => diagnostic.data != undefined))
				.map((diagnostics) => {
					const codeActions = diagnostics
						.values()
						.map((diagnostic) => diagnostic.data!.fix(utils))
						.filter((codeAction) => codeAction != null)

					const changes: Record<string, TextEdit[]> = {}
					const commands: { command: string, rest?: any[] }[] = []

					for (const codeAction of codeActions) {
						if (codeAction.edit?.changes) {
							for (const uri in codeAction.edit.changes) {
								(changes[uri] ??= []).push(...codeAction.edit.changes[uri])
							}
						}
						if (codeAction.command) {
							commands.push({ command: codeAction.command.command, rest: codeAction.command.arguments })
						}
					}

					return {
						title: `Fix all issues of kind '${diagnostics[0].message}'`,
						kind: CodeActionKind.QuickFix,
						diagnostics: diagnostics,
						...(Object.keys(changes).length && {
							edit: {
								changes
							}
						}),
						...(commands.length && {
							command: {
								title: "",
								command: "vscode-vdf.executeCommands",
								arguments: [commands]
							}
						})
					} satisfies CodeAction
				})
				.toArray()
		]
	}

	protected async onCodeLens(params: TextDocumentRequestParams<CodeLensParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		return await firstValueFrom(document.codeLens$)
	}

	protected abstract onDocumentFormatting(document: TDocument, params: TextDocumentRequestParams<DocumentFormattingParams>): Promise<TextEdit[]>

	private async onPrepareRename(params: TextDocumentRequestParams<PrepareRenameParams>) {

		await using document = await this.documents.get(params.textDocument.uri)
		const definitionReferences = await firstValueFrom(document.definitionReferences$)

		for (const { scope, type, key, value: definitions } of definitionReferences.definitions) {
			for (const definition of definitions) {
				if (Uri.equals(definition.uri, params.textDocument.uri)) {
					if (definition.keyRange.contains(params.position)) {
						this.oldName = [scope, type, key]
						return {
							range: definition.keyRange,
							placeholder: definition.key
						}
					}
					else if (definition.nameRange?.contains(params.position)) {
						this.oldName = [scope, type, key]
						return {
							range: definition.nameRange,
							placeholder: definition.key
						}
					}
				}
			}
		}

		for (const { scope, type, key, value: ranges } of definitionReferences.references.document()) {
			for (const range of ranges) {
				if (range.contains(params.position)) {
					this.oldName = [scope, type, key]
					return {
						range: range,
						placeholder: definitionReferences.definitions.get(scope, type, key)?.[0]?.key ?? key
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

		await using document = await this.documents.get(params.textDocument.uri)
		const [scope, type, key] = this.oldName
		this.oldName = null
		return { changes: await this.rename(document, scope, type, key, params.newName) }
	}

	protected abstract rename(document: TDocument, scope: number | null, type: symbol, key: string, newName: string): Promise<Record<string, TextEdit[]>>
}
