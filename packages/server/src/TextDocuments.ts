import { Uri } from "common/Uri"
import type { TextDocumentChangeEvent, TextDocumentConnection } from "vscode-languageserver/lib/common/textDocuments"
import type { TextDocumentBase, TextDocumentInit } from "./TextDocumentBase"

export interface TextDocumentsConfiguration<TDocument extends TextDocumentBase<any, any>> {
	open(uri: Uri): Promise<TextDocumentInit>
	create(init: TextDocumentInit): Promise<TDocument>
	onDidOpen: (event: TextDocumentChangeEvent<TDocument>) => Promise<() => void>
}

export class TextDocuments<
	TDocument extends TextDocumentBase<any, any>,
> {

	private readonly configuration: TextDocumentsConfiguration<TDocument>
	private readonly documents: Map<string, Promise<TDocument>>
	private readonly _onDidClose: Map<string, Promise<() => void>>

	constructor(configuration: TextDocumentsConfiguration<TDocument>) {
		this.configuration = configuration
		this.documents = new Map<string, Promise<TDocument>>()
		this._onDidClose = new Map()
	}

	public get(uri: Uri, open = false): Promise<TDocument> {
		const key = uri.toString()
		let document = this.documents.get(key)
		if (document) {
			return document
		}

		if (open) {
			// Don't await in this method or document will be opened twice
			const document = this
				.configuration
				.open(uri)
				.then(async (init) => await this.configuration.create(init))

			this.documents.set(uri.toString(), document)
			return document
		}

		throw new Error(`[TextDocuments] The given key "${key}" was not present in the map.`)
	}

	public listen(connection: TextDocumentConnection) {

		connection.onDidOpenTextDocument(async (params) => {

			const uri = new Uri(params.textDocument.uri)
			const key = uri.toString()

			let document = this.documents.get(key)
			if (!document) {
				document = this.configuration.create({
					uri: uri,
					languageId: params.textDocument.languageId,
					version: params.textDocument.version,
					content: params.textDocument.text,
				})

				this.documents.set(key, document)
			}

			document.then(async (document) => {
				this._onDidClose.set(key, this.configuration.onDidOpen({ document }))
			})
		})

		connection.onDidChangeTextDocument(async (params) => {
			if (params.contentChanges.length != 0) {
				const document = await this.documents.get(params.textDocument.uri)
				if (document) {
					document.update(params.contentChanges, params.textDocument.version)
				}
			}
		})

		connection.onDidCloseTextDocument(async (params) => {
			const key = new Uri(params.textDocument.uri).toString()
			this._onDidClose.get(key)?.then((onDidClose) => {
				onDidClose?.()
				this._onDidClose.delete(key)
			})
		})
	}
}
