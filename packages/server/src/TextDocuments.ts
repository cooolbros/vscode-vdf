import { Uri } from "common/Uri"
import { type TextDocumentChangeEvent, type TextDocumentConnection } from "vscode-languageserver/lib/common/textDocuments"
import type { TextDocumentBase, TextDocumentInit } from "./TextDocumentBase"

export interface TextDocumentsConfiguration<TDocument extends TextDocumentBase<any, any>> {
	open(uri: Uri): Promise<TextDocumentInit>
	create(init: TextDocumentInit, refCountDispose: (dispose: () => void) => void): Promise<TDocument>
	onDidOpen: (event: TextDocumentChangeEvent<TDocument>) => Promise<() => void>
}

export class TextDocuments<
	TDocument extends TextDocumentBase<any, any>,
> {

	private readonly configuration: TextDocumentsConfiguration<TDocument>
	private readonly documents: Map<string, { value: Promise<TDocument>, references: { value: number } }>
	private readonly _onDidClose: Map<string, Promise<() => void>>

	constructor(configuration: TextDocumentsConfiguration<TDocument>) {
		this.configuration = configuration
		this.documents = new Map()
		this._onDidClose = new Map()
	}

	private getOrInsertComputed(key: string, callbackFunction: () => Promise<TextDocumentInit>) {
		let document = this.documents.get(key)
		if (!document) {
			const references = { value: 0 }

			const refCountDispose = (dispose: () => void) => {
				references.value--
				if (references.value == 0) {
					dispose()
					this.documents.delete(key)
				}
			}

			document = {
				value: callbackFunction().then((init) => this.configuration.create(init, refCountDispose)),
				references: references
			}

			this.documents.set(key, document)
		}

		document.references.value++
		return document.value
	}

	public get(uri: Uri, open = false): Promise<TDocument> {
		const key = uri.toString()
		let document = this.documents.get(key)
		if (document) {
			document.references.value++
			return document.value
		}

		if (open) {
			// Don't await in this method or document will be opened twice
			return this.getOrInsertComputed(key, () => this.configuration.open(uri))
		}

		throw new Error(`[TextDocuments] The given key "${key}" was not present in the map.`)
	}

	public listen(connection: TextDocumentConnection) {

		connection.onDidOpenTextDocument(async (params: any) => {

			const uri = new Uri(params.textDocument.uri)
			const key = uri.toString()

			const document = await this.getOrInsertComputed(key, async () => ({
				uri: uri,
				languageId: params.textDocument.languageId,
				version: params.textDocument.version,
				content: params.textDocument.text,
			}))

			this._onDidClose.set(key, this.configuration.onDidOpen({ document }))
		})

		connection.onDidChangeTextDocument(async (params) => {
			if (params.contentChanges.length != 0) {
				const document = this.documents.get(params.textDocument.uri)
				if (document) {
					(await document.value).update(params.contentChanges, params.textDocument.version)
				}
			}
		})

		connection.onDidCloseTextDocument(async (params) => {
			const key = new Uri(params.textDocument.uri).toString()

			const onDidClose = await this._onDidClose.get(key)
			onDidClose?.()
			this._onDidClose.delete(key)
		})
	}
}
