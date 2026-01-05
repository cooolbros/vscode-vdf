import { defer, firstValueFrom, shareReplay, Subscription } from "rxjs"
import { FoldingRange, FoldingRangeKind, type CodeLensParams, type Connection, type FoldingRangeParams, type SignatureHelpParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocumentRequestParams } from "../../LanguageServer"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { PopfileTextDocument } from "./PopfileTextDocument"
import { PopfileWorkspace } from "./PopfileWorkspace"

export class PopfileLanguageServer extends VDFLanguageServer<"popfile", PopfileTextDocument> {

	private readonly workspace$ = defer(async () => new PopfileWorkspace(
		await this.fileSystems.get([{ type: "tf2" }]),
		this,
		this.documents,
	)).pipe(
		shareReplay(1)
	)

	private vscript = false

	constructor(languageId: "popfile", name: "Popfile", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "popfile",
			platform: platform,
			servers: new Set(),
			capabilities: {
				signatureHelpProvider: {
					// Squirrel
					triggerCharacters: ["(", ","]
				},
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
					await firstValueFrom(this.workspace$)
				)
			}
		})

		this.onTextDocumentRequest(this.connection.onSignatureHelp, this.onSignatureHelp)
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
					return documentSymbol.key.toLowerCase() == "Action".toLowerCase() && (documentSymbol.detail?.toLowerCase() == "RunScriptCode".toLowerCase() || documentSymbol.detail?.toLowerCase() == "RunScriptFile".toLowerCase())
				})

				if (vscript) {
					this.vscript = true
					this.trpc.client.popfile.vscript.install.query({ name: event.document.uri.basename() })
				}
			})
		}

		return stack.move()
	}

	protected async onCodeLens(params: TextDocumentRequestParams<CodeLensParams>) {
		const codeLens = await super.onCodeLens(params)

		await using document = await this.documents.get(params.textDocument.uri)
		const documentSymbols = await firstValueFrom(document.documentSymbols$)

		if (params.textDocument.uri.basename().startsWith("mvm_")) {
			const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key != "#base")
			if (waveSchedule?.children) {
				codeLens.unshift({
					range: waveSchedule.nameRange,
					command: {
						title: "$(output-view-icon) Wave Status Preview",
						command: "vscode-vdf.showWaveStatusPreviewToSide"
					}
				})
			}
		}

		return codeLens
	}

	private onSignatureHelp(params: TextDocumentRequestParams<SignatureHelpParams>) {
		return null
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
