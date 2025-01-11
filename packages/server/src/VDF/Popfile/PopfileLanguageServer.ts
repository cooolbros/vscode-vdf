import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { Uri } from "common/Uri"
import { firstValueFrom, Subscription } from "rxjs"
import { FoldingRange, FoldingRangeKind, InlayHint, InlayHintKind, InlayHintRequest, type Connection, type FoldingRangeParams, type InlayHintParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocumentRequestParams } from "../../LanguageServer"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { PopfileTextDocument, type PopfileTextDocumentDependencies } from "./PopfileTextDocument"
import colours from "./colours.json"

export class PopfileLanguageServer extends VDFLanguageServer<"popfile", PopfileTextDocument, PopfileTextDocumentDependencies> {

	private vscript = false

	constructor(languageId: "popfile", name: "Popfile", connection: Connection) {
		super(languageId, name, connection, {
			name: "popfile",
			servers: new Set(),
			capabilities: {
				foldingRangeProvider: true,
				inlayHintProvider: true,
			},
			createDocument: async (init, documentConfiguration$, refCountDispose) => {
				return new PopfileTextDocument(
					init,
					documentConfiguration$,
					this.fileSystems.get((teamFortress2Folder) => [
						{ type: "tf2", uri: teamFortress2Folder }
					]),
					this.documents,
					refCountDispose
				)
			}
		})

		this.onTextDocumentRequest(this.connection.onFoldingRanges, this.onFoldingRanges)

		this.connection.onRequest(InlayHintRequest.method, async (params: InlayHintParams): Promise<InlayHint[]> => {
			using document = await this.documents.get(new Uri(params.textDocument.uri))
			return (await firstValueFrom(document.documentSymbols$)).reduceRecursive(
				[] as InlayHint[],
				(inlayHints, documentSymbol) => {
					if (documentSymbol.key.toLowerCase() == "set item tint rgb".toLowerCase() && documentSymbol.detailRange) {
						if (((detail): detail is keyof typeof colours => detail in colours)(documentSymbol.detail!)) {
							inlayHints.push({
								position: documentSymbol.detailRange.end,
								label: colours[documentSymbol.detail!],
								kind: InlayHintKind.Type,
								paddingLeft: true
							})
						}
					}
					return inlayHints
				}
			)
		})
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return super.router(t)
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<PopfileTextDocument>): Promise<{ onDidClose: () => void }> {

		const { onDidClose } = await super.onDidOpen(event)

		const key = await this.trpc.client.window.createTextEditorDecorationType.mutate({
			options: {
				after: {
					margin: "0 0 0 0.5rem",
					color: "#99999959",
				}
			}
		})

		const subscriptions: Subscription[] = []

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

		return {
			onDidClose: () => {
				onDidClose()
				for (const subscription of subscriptions) {
					subscription.unsubscribe()
				}
			}
		}
	}

	private async onFoldingRanges(params: TextDocumentRequestParams<FoldingRangeParams>) {
		using document = await this.documents.get(params.textDocument.uri)
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
