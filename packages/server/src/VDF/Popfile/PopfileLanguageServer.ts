import { firstValueFrom, from, map, of, Subscription, switchMap } from "rxjs"
import { FoldingRange, FoldingRangeKind, type Connection, type FoldingRangeParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocumentRequestParams } from "../../LanguageServer"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { PopfileTextDocument } from "./PopfileTextDocument"
import { PopfileWorkspace } from "./PopfileWorkspace"

export class PopfileLanguageServer extends VDFLanguageServer<"popfile", PopfileTextDocument> {

	private readonly workspace = Promise.try(async () => new PopfileWorkspace(
		await this.fileSystems.get([{ type: "tf2" }]),
		async (uri) => await this.trpc.client.popfile.bsp.entities.query({ uri }),
		(uri) => from(this.trpc.servers.vmt.baseTexture.query({ uri })).pipe(
			switchMap((observable) => observable),
			switchMap((uri) => {
				if (uri != null) {
					return from(this.trpc.client.popfile.classIcon.flags.query({ uri })).pipe(
						switchMap((observable) => observable),
						map((flags) => ({ uri, flags }))
					)
				}

				return of(null)
			})
		),
		this.documents,
	))

	private vscript = false

	constructor(languageId: "popfile", name: "Popfile", connection: Connection) {
		super(languageId, name, connection, {
			name: "popfile",
			servers: new Set(),
			capabilities: {
				foldingRangeProvider: true,
			},
			createDocument: async (init, documentConfiguration$) => {
				return new PopfileTextDocument(
					init,
					documentConfiguration$,
					await this.fileSystems.get([
						{ type: "folder", uri: init.uri.dirname() },
						{ type: "tf2" }
					]),
					this.documents,
					await this.workspace
				)
			}
		})

		this.onTextDocumentRequest(this.connection.onFoldingRanges, this.onFoldingRanges)
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<PopfileTextDocument>): Promise<AsyncDisposable> {

		const stack = new AsyncDisposableStack()
		stack.use(await super.onDidOpen(event))

		const key = await this.trpc.client.window.createTextEditorDecorationType.mutate({
			options: {
				after: {
					margin: "0 0 0 0.5rem",
					color: "#99999959",
				}
			}
		})

		const subscriptions: Subscription[] = []
		stack.defer(() => {
			for (const subscription of subscriptions) {
				subscription.unsubscribe()
			}
		})

		subscriptions.push(
			event.document.decorations$.subscribe((decorations) => {
				this.trpc.client.textDocument.decoration.mutate({
					uri: event.document.uri,
					key: key,
					decorations: decorations
				})
			})
		)

		if (this.vscript == false) {
			firstValueFrom(event.document.documentSymbols$).then((documentSymbols) => {

				if (this.vscript) {
					return
				}

				const vscript = documentSymbols.findRecursive((documentSymbol) => {
					return documentSymbol.key.toLowerCase() == "Action".toLowerCase() && (documentSymbol.detail == "RunScriptCode".toLowerCase() || documentSymbol.detail == "RunScriptFile".toLowerCase())
				})

				if (vscript) {
					this.vscript = true
					this.trpc.client.popfile.vscript.install.query({ name: event.document.uri.basename() })
				}
			})
		}

		return stack.move()
	}

	private async onFoldingRanges(params: TextDocumentRequestParams<FoldingRangeParams>) {
		await using document = await this.documents.get(params.textDocument.uri)
		return (await firstValueFrom(document.documentSymbols$)).reduceRecursive(
			[] as FoldingRange[],
			(foldingRanges, documentSymbol) => {
				if (documentSymbol.key.toLowerCase() == "Param".toLowerCase() && documentSymbol.detailRange) {
					foldingRanges.push({
						startLine: documentSymbol.detailRange.start.line,
						startCharacter: documentSymbol.detailRange.start.character,
						endLine: documentSymbol.detailRange.end.line,
						endCharacter: documentSymbol.detailRange.end.character,
						kind: FoldingRangeKind.Region,
					})
				}
				return foldingRanges
			}
		)
	}
}
