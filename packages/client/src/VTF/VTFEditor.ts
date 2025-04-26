import { commands, EventEmitter, FilePermission, Uri, window, workspace, type CancellationToken, type CustomDocumentBackup, type CustomDocumentBackupContext, type CustomDocumentEditEvent, type CustomDocumentOpenContext, type CustomEditorProvider, type Event, type WebviewPanel } from "vscode"
import { z } from "zod"
import { VTFDocument } from "./VTFDocument"

export class VTFEditor implements CustomEditorProvider<VTFDocument> {

	private static readonly decoder = new TextDecoder("utf-8")
	public static readonly commandSchema = z.union([
		z.object({ type: z.literal("buf") }),
		z.object({ type: z.literal("flags"), label: z.string(), value: z.number() }),
		z.object({ type: z.literal("scale"), scale: z.number().min(10).max(200) }),
		z.object({ type: z.literal("showErrorMessage"), message: z.string(), items: z.string().array() }),
		z.object({ type: z.literal("unsupportedVTFFormat"), format: z.string() })
	])

	public readonly extensionUri: Uri
	private readonly onDidChangeCustomDocumentEventEmitter: EventEmitter<CustomDocumentEditEvent<VTFDocument>>
	public readonly onDidChangeCustomDocument: Event<CustomDocumentEditEvent<VTFDocument>>

	public constructor(extensionUri: Uri, subscriptions: { dispose(): any }[]) {
		this.extensionUri = extensionUri
		this.onDidChangeCustomDocumentEventEmitter = new EventEmitter()
		this.onDidChangeCustomDocument = this.onDidChangeCustomDocumentEventEmitter.event

		const selectVTFZoomLevelCommand = commands.registerCommand("vscode-vdf.selectVTFZoomLevel", async (document: VTFDocument) => {
			const result = await window.showQuickPick(Array.from({ length: 10 }, (_, i) => `${((i + 1) * 2) * 10}%`), { placeHolder: "Select zoom level" })
			if (result != undefined) {
				document.scale$.next(parseInt(result))
			}
		})

		subscriptions.push(
			this.onDidChangeCustomDocumentEventEmitter,
			selectVTFZoomLevelCommand
		)
	}

	public async saveCustomDocument(document: VTFDocument, cancellation: CancellationToken): Promise<void> {
		return await workspace.fs.writeFile(document.uri, document.save())
	}

	public async saveCustomDocumentAs(document: VTFDocument, destination: Uri, cancellation: CancellationToken): Promise<void> {
		return await workspace.fs.writeFile(destination, document.saveAs())
	}

	public async revertCustomDocument(document: VTFDocument, cancellation: CancellationToken): Promise<void> {
		document.revert()
	}

	public async backupCustomDocument(document: VTFDocument, context: CustomDocumentBackupContext, cancellation: CancellationToken): Promise<CustomDocumentBackup> {
		await workspace.fs.writeFile(context.destination, document.backup())
		return {
			id: context.destination.toString(),
			delete: async () => await workspace.fs.delete(context.destination),
		}
	}

	public async openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext, token: CancellationToken): Promise<VTFDocument> {
		const stat = await workspace.fs.stat(uri)
		const readonly = stat.permissions
			? (stat.permissions & FilePermission.Readonly) == FilePermission.Readonly
			: false

		const flags = openContext.backupId != undefined
			? new DataView((await workspace.fs.readFile(Uri.parse(openContext.backupId))).buffer).getUint32(0, true)
			: null
		return new VTFDocument(uri, readonly, new Uint8Array(await workspace.fs.readFile(uri)), flags)
	}

	public async resolveCustomEditor(document: VTFDocument, webviewPanel: WebviewPanel, token: CancellationToken): Promise<void> {

		const dist = Uri.joinPath(this.extensionUri, "apps/vtf-editor/dist")
		const html = VTFEditor.decoder.decode(await workspace.fs.readFile(Uri.joinPath(dist, "index.html")))

		webviewPanel.webview.options = { enableScripts: true }
		webviewPanel.webview.html = html
			.replaceAll("%READONLY%", `${document.readonly}`)
			.replaceAll("%BASE%", `${webviewPanel.webview.asWebviewUri(dist).toString()}/`)

		document.show()

		const stack = new DisposableStack()
		webviewPanel.onDidDispose(() => stack.dispose())

		stack.adopt(
			webviewPanel.onDidChangeViewState(() => {
				if (webviewPanel.visible) {
					webviewPanel.webview.postMessage(document.buf)
					document.show()
				}
				else {
					document.hide()
				}
			}),
			(disposable) => disposable.dispose()
		)

		stack.adopt(
			webviewPanel.webview.onDidReceiveMessage(async (message) => {
				const command = VTFEditor.commandSchema.parse(message)
				switch (command.type) {
					case "buf": {
						webviewPanel.webview.postMessage(document.buf)
						break
					}
					case "flags": {
						const prev = document.flags$.value
						document.flags$.next(prev ^ command.value)
						const next = document.flags$.value
						this.onDidChangeCustomDocumentEventEmitter.fire({
							document: document,
							undo: () => document.flags$.next(prev),
							redo: () => document.flags$.next(next),
							label: command.label
						})
						break
					}
					case "scale": {
						document.scale$.next(command.scale)
						break
					}
					case "showErrorMessage": {
						window.showErrorMessage(command.message, ...command.items)
						break
					}
					case "unsupportedVTFFormat": {
						const configuration = workspace.getConfiguration("vscode-vdf.vtf.formats")
						const exclude = configuration.get<string[]>("exclude") ?? []
						if (!exclude.includes(command.format)) {

							const requestSupportMessage = `(Github) Request support for "${command.format}"`
							const dontAskAgain = "Don't ask again"

							const result = await window.showErrorMessage(`Unsupported VTF format: "${command.format}"`, requestSupportMessage, dontAskAgain)
							if (result == requestSupportMessage) {
								const title = `Add support for ${command.format}`
								await commands.executeCommand("vscode.open", `https://github.com/cooolbros/vscode-vdf/issues/new?title=${title}`)
							}
							else if (result == dontAskAgain) {
								configuration.update("exclude", [...exclude, command.format], true)
							}
							break
						}
					}
				}
			}),
			(disposable) => disposable.dispose()
		)

		stack.adopt(
			document.flags$.subscribe((flags) => {
				webviewPanel.webview.postMessage({ type: "flags", flags })
			}),
			(subscription) => subscription.unsubscribe()
		)

		stack.adopt(
			document.scale$.subscribe((scale) => {
				webviewPanel.webview.postMessage({ type: "scale", value: scale })
			}),
			(subscription) => subscription.unsubscribe()
		)
	}
}
