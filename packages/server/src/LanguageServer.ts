import { createTRPCProxyClient, httpLink, type CreateTRPCProxyClient } from "@trpc/client"
import { initTRPC, type AnyRouter } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import type { clientRouter } from "client/TRPCClientRouter"
import { posix } from "path"
import type { languageNames } from "utils/languageNames"
import type { VSCodeVDFLanguageID } from "utils/types/VSCodeVDFLanguageID"
import { VDFSyntaxError } from "vdf"
import { CodeLensRefreshRequest, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentSymbol, TextDocuments, TextDocumentSyncKind, type Connection, type DocumentSymbolParams, type RequestHandler, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"
import { z } from "zod"
import { DocumentsConfiguration } from "./DocumentsConfiguration"
import type { HUDAnimationsLanguageServer } from "./HUDAnimations/HUDAnimationsLanguageServer"
import type { LanguageServerConfiguration } from "./LanguageServerConfiguration"
import type { PopfileLanguageServer } from "./VDF/Popfile/PopfileLanguageServer"
import type { VGUILanguageServer } from "./VDF/VGUI/VGUILanguageServer"
import type { VMTLanguageServer } from "./VDF/VMT/VMTLanguageServer"

export abstract class LanguageServer<T extends DocumentSymbol[]> {

	protected readonly name: typeof languageNames[keyof typeof languageNames]
	protected readonly languageId: keyof typeof languageNames
	protected readonly connection: Connection
	protected readonly languageServerConfiguration: LanguageServerConfiguration<T>
	protected readonly documents: TextDocuments<TextDocument>
	protected readonly documentsSymbols: Map<string, T>
	protected readonly documentsConfiguration: DocumentsConfiguration

	protected readonly trpc: {
		client: CreateTRPCProxyClient<typeof clientRouter>
		servers: {
			hudanimations: CreateTRPCProxyClient<ReturnType<HUDAnimationsLanguageServer["router"]>>
			popfile: CreateTRPCProxyClient<ReturnType<PopfileLanguageServer["router"]>>
			vgui: CreateTRPCProxyClient<ReturnType<VGUILanguageServer["router"]>>
			vmt: CreateTRPCProxyClient<ReturnType<VMTLanguageServer["router"]>>
		}
	}

	constructor(name: LanguageServer<T>["name"], languageId: LanguageServer<T>["languageId"], connection: Connection, configuration: LanguageServerConfiguration<T>) {

		this.name = name
		this.languageId = languageId
		this.connection = connection
		this.languageServerConfiguration = configuration
		this.documents = new TextDocuments({
			create(uri, languageId, version, content) {
				return TextDocument.create(decodeURIComponent(uri), languageId, version, content)
			},
			update(document, changes, version) {
				return TextDocument.update(document, changes, version)
			},
		})
		this.documentsSymbols = new Map<string, T>()
		this.documentsConfiguration = new DocumentsConfiguration(this.connection)

		let _router: AnyRouter

		const resolveTRPC = async (input: string, init?: RequestInit) => {
			_router ??= this.router(initTRPC.create())
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

		const VSCodeRPCLink = (server: VSCodeVDFLanguageID | null) => httpLink({
			url: "",
			fetch: async (input, init) => {
				let body: Promise<string>

				if (server != languageId) {
					body = this.connection.sendRequest(
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
					body = resolveTRPC(url, init)
				}
				return new Response(await body)
			}
		})

		this.trpc = {
			client: createTRPCProxyClient<typeof clientRouter>({ links: [VSCodeRPCLink(null)] }),
			servers: {
				hudanimations: createTRPCProxyClient<ReturnType<HUDAnimationsLanguageServer["router"]>>({ links: [VSCodeRPCLink("hudanimations")] }),
				popfile: createTRPCProxyClient<ReturnType<PopfileLanguageServer["router"]>>({ links: [VSCodeRPCLink("popfile")] }),
				vgui: createTRPCProxyClient<ReturnType<VGUILanguageServer["router"]>>({ links: [VSCodeRPCLink("vdf")] }),
				vmt: createTRPCProxyClient<ReturnType<VMTLanguageServer["router"]>>({ links: [VSCodeRPCLink("vmt")] }),
			}
		}

		this.connection.onInitialize((params) => {
			// this.connection.console.log(JSON.stringify(params, null, 2))
			return {
				serverInfo: {
					name: `${this.name} Language Server`
				},
				capabilities: {
					...this.getCapabilities(),
					textDocumentSync: TextDocumentSyncKind.Incremental,
					documentSymbolProvider: true,
				},
				servers: [...this.languageServerConfiguration.servers]
			}
		})

		this.documents.onDidOpen(this.onDidOpen.bind(this))
		this.documents.onDidChangeContent(this.onDidChangeContent.bind(this))
		this.documents.onDidSave(this.onDidSave.bind(this))
		this.documents.onDidClose(this.onDidClose.bind(this))

		this.onTextDocumentRequest(this.connection.onDocumentSymbol, this.onDocumentSymbol)

		this.documents.listen(this.connection)
		this.connection.listen()
	}

	protected router(t: ReturnType<typeof initTRPC.create>) {
		return t.router({
			textDocument: t.router({
				documentSymbol: t
					.procedure
					.input(
						z.object({
							uri: z.string()
						})
					)
					.query(async ({ input }) => {
						return await this.onDocumentSymbol({ textDocument: input })
					})
			})
		})
	}

	protected onTextDocumentRequest<P extends { textDocument: { uri: string } }, R, E>(
		listener: (handler: RequestHandler<P, R | null, E>) => { dispose(): void },
		callback: (params: P) => R | null | Promise<R | null>
	) {
		listener(async (params) => {
			params.textDocument.uri = decodeURIComponent(params.textDocument.uri)
			try {
				return await callback.call(this, params)
			}
			catch (error: any) {
				console.error(error.message)
				this.connection.console.error(error.message)
			}
			return null
		})
	}

	protected async getFilesCompletion(document: { uri: string }, { items = [], uri, relativePath, query, startsWithFilter, extensionsFilter, displayExtensions }: { items?: CompletionItem[], uri: string, relativePath?: string, query?: `?${string}`, startsWithFilter?: string, extensionsFilter?: string[], displayExtensions: boolean }) {
		const configuration = this.documentsConfiguration.get(document.uri)
		if (!configuration) {
			return []
		}

		const basename = posix.basename(document.uri)
		startsWithFilter = startsWithFilter?.toLowerCase()

		const filters = [
			(name: string, type: number) => posix.basename(name) != basename,
			(name: string, type: number) => !items.some((item) => item.label == name),
			configuration.filesAutoCompletionKind == "all" ? (name: string, type: number) => type == 1 : null,
			startsWithFilter ? (name: string, type: number) => name.toLowerCase().startsWith(startsWithFilter) : null,
			extensionsFilter ? (name: string, type: number) => extensionsFilter.includes(posix.extname(name)) : null,
		].filter((f) => f != null)

		const filter = (name: string, type: number) => filters.every((filter) => filter(name, type))

		if (configuration.filesAutoCompletionKind == "incremental") {
			for (const [name, type] of await this.trpc.client.fileSystem.readDirectory.query({ uri: `${uri}${relativePath ? `/${relativePath}` : ""}${query}` })) {
				if (filter(name, type)) {
					if (!items.some((item) => item.label == name)) {
						items.push({
							label: name, // Display file extension in label so VSCode displays the associated icon
							kind: type == 1 ? CompletionItemKind.File : CompletionItemKind.Folder,
							insertText: displayExtensions ? name : posix.parse(name).name,
							commitCharacters: ["/"],
						})
					}
				}
			}
		}
		else {
			for (const [name, type] of await this.trpc.client.fileSystem.readDirectory.query({ uri: `${uri}${query}`, recursive: true })) {
				if (filter(name, type)) {

					let insertText
					if (displayExtensions) {
						insertText = name
					}
					else {
						const path = posix.parse(name)
						insertText = posix.join(path.dir, path.name)
					}

					items.push({
						label: name, // Display file extension in label so VSCode displays the associated icon
						kind: CompletionItemKind.File,
						insertText: insertText
					})
				}
			}
		}

		return items
	}

	protected abstract getCapabilities(): ServerCapabilities

	protected async onDidOpen(e: TextDocumentChangeEvent<TextDocument>): Promise<void> {

		this.documentsConfiguration.add(e.document.uri)

		let documentSymbols: T
		let diagnostics: VDFSyntaxError | Diagnostic[] = []
		try {
			documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(e.document.uri, e.document.getText())
			this.documentsSymbols.set(e.document.uri, documentSymbols)
			diagnostics = await this.validateTextDocument(e.document.uri, documentSymbols)
		}
		catch (error: unknown) {
			documentSymbols = this.languageServerConfiguration.defaultDocumentSymbols()
			this.documentsSymbols.set(e.document.uri, documentSymbols)
			if (error instanceof VDFSyntaxError) {
				diagnostics = error
			}
			else {
				throw error
			}
		}

		this.sendDiagnostics(e.document.uri, diagnostics)
	}

	/**
	 * @returns Whether the text document change was parsed successfully
	 */
	protected async onDidChangeContent(e: TextDocumentChangeEvent<TextDocument>): Promise<boolean> {

		const documentConfiguration = this.documentsConfiguration.get(e.document.uri)
		if (documentConfiguration == undefined) {
			return false
		}

		const shouldSendDiagnostics = documentConfiguration.updateDiagnosticsEvent == "type"

		try {
			const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(e.document.uri, e.document.getText())
			this.documentsSymbols.set(e.document.uri, documentSymbols)
			const diagnostics = await this.validateTextDocument(e.document.uri, documentSymbols)
			if (shouldSendDiagnostics) {
				this.sendDiagnostics(e.document.uri, diagnostics)
			}
			return true
		}
		catch (error: any) {
			if (error instanceof VDFSyntaxError) {
				if (shouldSendDiagnostics) {
					this.sendDiagnostics(e.document.uri, error)
				}
			}
			else {
				throw error
			}
			return false
		}
	}

	protected onDidSave(e: TextDocumentChangeEvent<TextDocument>): void {

		const documentConfiguration = this.documentsConfiguration.get(e.document.uri)
		if (documentConfiguration == undefined) {
			return
		}

		const shouldSendDiagnostics = documentConfiguration.updateDiagnosticsEvent == "save"

		if (!shouldSendDiagnostics) {
			return
		}

		try {
			this.languageServerConfiguration.parseDocumentSymbols(e.document.uri, e.document.getText())
			this.connection.sendDiagnostics({
				uri: e.document.uri,
				diagnostics: []
			})
		}
		catch (error: unknown) {
			if (error instanceof VDFSyntaxError) {
				this.sendDiagnostics(e.document.uri, error)
			}
			else {
				throw error
			}
		}
	}

	protected onDidClose(e: TextDocumentChangeEvent<TextDocument>): void {
		this.connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] })
		this.documentsSymbols.delete(e.document.uri)
		this.documentsConfiguration.delete(e.document.uri)
	}

	protected abstract validateTextDocument(uri: string, documentSymbols: T): Promise<Diagnostic[]>

	private sendDiagnostics(uri: string, diagnostics: VDFSyntaxError | Diagnostic[]): void {
		this.connection.sendDiagnostics({
			uri: uri,
			diagnostics: !Array.isArray(diagnostics) ? [
				{
					range: diagnostics.range,
					severity: DiagnosticSeverity.Error,
					code: diagnostics.name, // Don't use diagnostics.constructor.name because webpack obfuscates class names
					source: this.languageId,
					message: diagnostics.message
				}
			] : diagnostics.map((diagnostic) => ({ ...diagnostic, source: this.languageId }))
		})
	}

	private async onDocumentSymbol(params: DocumentSymbolParams) {

		if (!this.documentsSymbols.has(params.textDocument.uri)) {
			this.documentsSymbols.set(params.textDocument.uri, this.languageServerConfiguration.parseDocumentSymbols(params.textDocument.uri, await this.trpc.client.fileSystem.readFile.query({ uri: params.textDocument.uri })))
		}

		return this.documentsSymbols.get(params.textDocument.uri)!
	}

	protected codeLensRefresh(): void {
		this.connection.sendRequest(CodeLensRefreshRequest.method)
	}
}
