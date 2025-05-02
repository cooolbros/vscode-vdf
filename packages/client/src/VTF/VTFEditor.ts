import { Uri } from "common/Uri"
import vscode, { commands, Disposable, EventEmitter, FilePermission, window, workspace, type CancellationToken, type CustomDocumentBackup, type CustomDocumentBackupContext, type CustomDocumentEditEvent, type CustomDocumentOpenContext, type CustomEditorProvider, type Event, type WebviewPanel } from "vscode"
import { z } from "zod"
import type { FileSystemWatcherFactory } from "../FileSystemWatcherFactory"
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

	private readonly extensionUri: vscode.Uri
	private readonly fileSystemWatcherFactory: FileSystemWatcherFactory
	private readonly onDidChangeCustomDocumentEventEmitter: EventEmitter<CustomDocumentEditEvent<VTFDocument>>
	public readonly onDidChangeCustomDocument: Event<CustomDocumentEditEvent<VTFDocument>>

	public constructor(extensionUri: vscode.Uri, fileSystemWatcherFactory: FileSystemWatcherFactory, subscriptions: Disposable[]) {
		this.extensionUri = extensionUri
		this.fileSystemWatcherFactory = fileSystemWatcherFactory
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

	public async saveCustomDocumentAs(document: VTFDocument, destination: vscode.Uri, cancellation: CancellationToken): Promise<void> {
		return await workspace.fs.writeFile(destination, document.saveAs())
	}

	public async revertCustomDocument(document: VTFDocument, cancellation: CancellationToken): Promise<void> {
		await document.revert()
	}

	public async backupCustomDocument(document: VTFDocument, context: CustomDocumentBackupContext, cancellation: CancellationToken): Promise<CustomDocumentBackup> {
		await workspace.fs.writeFile(context.destination, document.backup())
		return {
			id: context.destination.toString(),
			delete: async () => await workspace.fs.delete(context.destination),
		}
	}

	public async openCustomDocument(uri: vscode.Uri, openContext: CustomDocumentOpenContext, token: CancellationToken): Promise<VTFDocument> {
		const [readonly, buf, watcher, flags] = await Promise.all([
			Promise.try(async () => {
				const stat = await workspace.fs.stat(uri)
				return stat.permissions
					? (stat.permissions & FilePermission.Readonly) == FilePermission.Readonly
					: false
			}),
			Promise.try(async () => new Uint8Array(await workspace.fs.readFile(uri))),
			this.fileSystemWatcherFactory.get(new Uri(uri)),
			openContext.backupId != undefined
				? Promise.try(async () => new DataView((await workspace.fs.readFile(new Uri(openContext.backupId!))).buffer).getUint32(0, true))
				: Promise.resolve(null),

		])

		return new VTFDocument(uri, readonly, buf, watcher, flags)
	}

	public async resolveCustomEditor(document: VTFDocument, webviewPanel: WebviewPanel, token: CancellationToken): Promise<void> {

		const dist = vscode.Uri.joinPath(this.extensionUri, "apps/vtf-editor/dist")
		const html = VTFEditor.decoder.decode(await workspace.fs.readFile(vscode.Uri.joinPath(dist, "index.html")))

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
					webviewPanel.webview.postMessage(document.buf$.value)
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
						webviewPanel.webview.postMessage(document.buf$.value)
						break
					}
					case "flags": {
						const prev = document.flags$.value
						document.flags$.next(prev ^ command.value)
						document.changes++
						const next = document.flags$.value
						this.onDidChangeCustomDocumentEventEmitter.fire({
							document: document,
							undo: () => {
								document.flags$.next(prev)
								document.changes--
							},
							redo: () => {
								document.flags$.next(next)
								document.changes++
							},
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
