import { CodeLensRefreshRequest, Diagnostic, DiagnosticSeverity, DocumentSymbol, TextDocumentSyncKind, TextDocuments, type Connection, type DocumentSymbolParams, type InitializeParams, type InitializeResult, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"
import { VDFSyntaxError } from "../VDF/VDFErrors"
import type { languageClientsInfo } from "../languageClientsInfo"
import type { VSCodeVDFFileSystem } from "../types/VSCodeVDFFileSystem"
import { DocumentsConfiguration } from "./DocumentsConfiguration"
import type { LanguageServerConfiguration } from "./LanguageServerConfiguration"
import { LanguageServerFileSystem } from "./LanguageServerFileSystem"

export abstract class LanguageServer<T extends DocumentSymbol[]> {

	protected readonly name: typeof languageClientsInfo[keyof typeof languageClientsInfo]["name"]
	protected readonly languageId: typeof languageClientsInfo[keyof typeof languageClientsInfo]["id"]
	protected readonly connection: Connection
	protected readonly fileSystem: VSCodeVDFFileSystem
	protected readonly languageServerConfiguration: LanguageServerConfiguration<T>
	protected readonly documents: TextDocuments<TextDocument>
	protected readonly documentsSymbols: Map<string, T>
	protected readonly documentsConfiguration: DocumentsConfiguration

	constructor(name: LanguageServer<T>["name"], languageId: LanguageServer<T>["languageId"], connection: Connection, configuration: LanguageServerConfiguration<T>) {

		this.name = name
		this.languageId = languageId
		this.connection = connection
		this.fileSystem = new LanguageServerFileSystem(this.connection)
		this.languageServerConfiguration = configuration
		this.documents = new TextDocuments(TextDocument)
		this.documentsSymbols = new Map<string, T>()
		this.documentsConfiguration = new DocumentsConfiguration(this.connection)

		this.connection.onInitialize(this.onInitialize.bind(this))

		this.documents.onDidOpen(this.onDidOpen.bind(this))
		this.documents.onDidChangeContent(this.onDidChangeContent.bind(this))
		this.documents.onDidSave(this.onDidSave.bind(this))
		this.documents.onDidClose(this.onDidClose.bind(this))

		this.connection.onDocumentSymbol(this.onDocumentSymbol.bind(this))

		this.documents.listen(this.connection)
		this.connection.listen()
	}

	private onInitialize(params: InitializeParams): InitializeResult {
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
			servers: this.languageServerConfiguration.servers
		}
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

	private async onDocumentSymbol(params: DocumentSymbolParams): Promise<DocumentSymbol[] | undefined> {

		if (!this.documentsSymbols.has(params.textDocument.uri)) {
			this.documentsSymbols.set(params.textDocument.uri, this.languageServerConfiguration.parseDocumentSymbols(params.textDocument.uri, await this.fileSystem.readFile(params.textDocument.uri)))
		}

		return this.documentsSymbols.get(params.textDocument.uri)
	}

	protected codeLensRefresh(): void {
		this.connection.sendRequest(CodeLensRefreshRequest.method)
	}
}
