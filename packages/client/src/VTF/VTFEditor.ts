import { initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { devalueTransformer } from "common/devalueTransformer"
import { Uri } from "common/Uri"
import vscode, { commands, Disposable, EventEmitter, FilePermission, window, workspace, type CancellationToken, type CustomDocumentBackup, type CustomDocumentBackupContext, type CustomDocumentEditEvent, type CustomDocumentOpenContext, type CustomEditorProvider, type Event, type WebviewPanel } from "vscode"
import z from "zod"
import type { FileSystemWatcherFactory } from "../FileSystemWatcherFactory"
import { TRPCImageRouter } from "../TRPCImageRouter"
import { TRPCWebViewRequestHandler } from "../TRPCWebViewRequestHandler"
import { VTFDocument } from "./VTFDocument"

export class VTFEditor implements CustomEditorProvider<VTFDocument> {

	private static readonly decoder = new TextDecoder("utf-8")

	private readonly extensionUri: vscode.Uri
	private readonly fileSystemWatcherFactory: FileSystemWatcherFactory
	private readonly onDidChangeCustomDocumentEventEmitter: EventEmitter<CustomDocumentEditEvent<VTFDocument>>
	private readonly webviewPanels: Map<string, WebviewPanel>
	public readonly onDidChangeCustomDocument: Event<CustomDocumentEditEvent<VTFDocument>>

	public constructor(extensionUri: vscode.Uri, fileSystemWatcherFactory: FileSystemWatcherFactory, subscriptions: Disposable[]) {
		this.extensionUri = extensionUri
		this.fileSystemWatcherFactory = fileSystemWatcherFactory
		this.onDidChangeCustomDocumentEventEmitter = new EventEmitter()
		this.webviewPanels = new Map()
		this.onDidChangeCustomDocument = this.onDidChangeCustomDocumentEventEmitter.event

		const selectVTFZoomLevelCommand = commands.registerCommand("vscode-vdf.selectVTFZoomLevel", async (document: VTFDocument) => {
			const result = await window.showQuickPick(Array.from({ length: 10 }, (_, i) => `${((i + 1) * 2) * 10}%`), { placeHolder: "Select zoom level" })
			if (result != undefined) {
				document.scale$.next(parseInt(result))
			}
		})

		const send = (command: string) => {
			return (arg: any) => {
				const webviewPanel = this.webviewPanels.get(arg.uri)
				if (webviewPanel) {
					webviewPanel.reveal()
					webviewPanel.webview.postMessage({ type: "context_menu", command: command })
				}
			}
		}

		const saveImageAsCommand = commands.registerCommand("vscode-vdf.VTFEditorSaveImageAs", send("vscode-vdf.VTFEditorSaveImageAs"))
		const copyImageCommand = commands.registerCommand("vscode-vdf.VTFEditorCopyImage", send("vscode-vdf.VTFEditorCopyImage"))

		subscriptions.push(
			this.onDidChangeCustomDocumentEventEmitter,
			selectVTFZoomLevelCommand,
			saveImageAsCommand,
			copyImageCommand
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

		const stack = new DisposableStack()
		webviewPanel.onDidDispose(() => stack.dispose())

		const id = document.uri.toString()
		this.webviewPanels.set(id, webviewPanel)
		stack.defer(() => this.webviewPanels.delete(id))

		stack.adopt(
			webviewPanel.onDidChangeViewState(() => {
				if (webviewPanel.visible) {
					document.show()
				}
				else {
					document.hide()
				}
			}),
			(disposable) => disposable.dispose()
		)

		const router = this.router(document)
		stack.use(TRPCWebViewRequestHandler(webviewPanel.webview, router))

		const dist = vscode.Uri.joinPath(this.extensionUri, "apps/vtf-editor/dist")
		const html = VTFEditor.decoder.decode(await workspace.fs.readFile(vscode.Uri.joinPath(dist, "index.html")))

		webviewPanel.webview.options = { enableScripts: true }
		webviewPanel.webview.html = html
			.replace("%URI%", `${document.uri}`)
			.replace("%READONLY%", `${document.readonly}`)
			.replace("%BASE%", `${webviewPanel.webview.asWebviewUri(dist).toString()}/`)

		document.show()
	}

	public router(document: VTFDocument) {
		const t = initTRPC.create({
			transformer: devalueTransformer({ reducers: {}, revivers: {} }),
			isDev: true
		})

		return t.mergeRouters(
			TRPCImageRouter(t),
			t.router({
				buf: t.procedure.query(() => document.buf$.value),
				flags: {
					events: t
						.procedure
						.subscription(({ signal }) => {
							return observableToAsyncIterable<number>(document.flags$, signal!)
						}),
					set: t
						.procedure
						.input(
							z.object({
								label: z.string(),
								value: z.number(),
							})
						)
						.mutation(({ input }) => {
							const prev = document.flags$.value
							document.flags$.next(prev ^ input.value)
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
								label: input.label
							})
						})
				},
				scale: {
					events: t
						.procedure
						.subscription(({ signal }) => {
							return observableToAsyncIterable<number>(document.scale$, signal!)
						}),
					set: t
						.procedure
						.input(z.number().min(10).max(200))
						.mutation(({ input }) => {
							document.scale$.next(input)
						})
				},
				showErrorMessage: t
					.procedure
					.input(
						z.object({
							message: z.string(),
							items: z.array(z.string())
						})
					)
					.query(async ({ input }) => {
						window.showErrorMessage(input.message, ...input.items)
					}),
				unsupportedVTFFormat: t
					.procedure
					.input(
						z.object({
							format: z.string()
						})
					)
					.mutation(async ({ input }) => {
						const configuration = workspace.getConfiguration("vscode-vdf.vtf.formats")
						const exclude = configuration.get<string[]>("exclude") ?? []
						if (!exclude.includes(input.format)) {

							const requestSupportMessage = `(Github) Request support for "${input.format}"`
							const dontAskAgain = "Don't ask again"

							const result = await window.showErrorMessage(`Unsupported VTF format: "${input.format}"`, requestSupportMessage, dontAskAgain)
							if (result == requestSupportMessage) {
								const title = `Add support for ${input.format}`
								await commands.executeCommand("vscode.open", `https://github.com/cooolbros/vscode-vdf/issues/new?title=${title}`)
							}
							else if (result == dontAskAgain) {
								configuration.update("exclude", [...exclude, input.format], true)
							}
						}
					}),
			})
		)
	}
}
