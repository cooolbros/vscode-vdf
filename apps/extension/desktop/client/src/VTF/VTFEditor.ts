import { existsSync, mkdirSync, readFileSync, rmSync } from "fs"
import { writeFile } from "fs/promises"
import { dirname, join } from "path"
import { Disposable, EventEmitter, Uri, commands, window, workspace, type CancellationToken, type CustomDocumentBackup, type CustomDocumentBackupContext, type CustomDocumentEditEvent, type CustomDocumentOpenContext, type CustomEditorProvider, type Event, type ExtensionContext, type WebviewPanel, type WebviewPanelOnDidChangeViewStateEvent } from "vscode"
import type { VTFBackup } from "./VTF"
import { VTFDocument } from "./VTFDocument"

export class VTFEditor implements CustomEditorProvider<VTFDocument> {

	private readonly context: ExtensionContext

	private readonly onDidChangeCustomDocumentEventEmitter: EventEmitter<CustomDocumentEditEvent<VTFDocument>>
	public readonly onDidChangeCustomDocument: Event<CustomDocumentEditEvent<VTFDocument>>

	private readonly selectVTFZoomLevelCommand: Disposable

	constructor(context: ExtensionContext) {
		this.context = context
		this.onDidChangeCustomDocumentEventEmitter = new EventEmitter<CustomDocumentEditEvent<VTFDocument>>()
		this.onDidChangeCustomDocument = this.onDidChangeCustomDocumentEventEmitter.event
		this.selectVTFZoomLevelCommand = commands.registerCommand("vscode-vdf.selectVTFZoomLevel", async (document: VTFDocument) => {
			const result = await window.showQuickPick(Array.from({ length: 10 }, (_, i) => `${((i + 1) * 2) * 10}%`), { placeHolder: "Select zoom level" })
			if (result != undefined) {
				document.scale = parseFloat(result) / 100
			}
		})
		context.subscriptions.push(this.onDidChangeCustomDocumentEventEmitter, this.selectVTFZoomLevelCommand)
	}

	public saveCustomDocument(document: VTFDocument, cancellation: CancellationToken): Thenable<void> {
		if (document.isReadOnly) {
			// git:// protocols are readonly
			return Promise.resolve()
		}
		return workspace.fs.writeFile(document.uri, document.save())
	}

	public saveCustomDocumentAs(document: VTFDocument, destination: Uri, cancellation: CancellationToken): Thenable<void> {
		if (document.isReadOnly) {
			// git:// protocols are readonly
			return Promise.resolve()
		}
		return workspace.fs.writeFile(destination, document.saveAs())
	}

	public revertCustomDocument(document: VTFDocument, cancellation: CancellationToken): Thenable<void> {
		return (async (): Promise<void> => {
			document.revert()
		})()
	}

	public backupCustomDocument(document: VTFDocument, context: CustomDocumentBackupContext, cancellation: CancellationToken): Thenable<CustomDocumentBackup> {
		return (async (): Promise<CustomDocumentBackup> => {
			const backupDirectory = dirname(context.destination.fsPath)
			if (!existsSync(backupDirectory)) {
				mkdirSync(backupDirectory, { recursive: true })
			}
			await writeFile(context.destination.fsPath, JSON.stringify(document.getBackup()))
			return {
				id: context.destination.fsPath,
				delete: (): void => {
					if (existsSync(context.destination.fsPath)) {
						rmSync(context.destination.fsPath)
					}
				}
			}
		})()
	}

	public openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext, token: CancellationToken): VTFDocument | Thenable<VTFDocument> {
		const backup: VTFBackup | undefined = openContext.backupId != undefined && existsSync(openContext.backupId) ? JSON.parse(readFileSync(openContext.backupId, "utf-8")) : undefined
		return VTFDocument.create(this.context.extensionPath, uri, backup)
	}

	public resolveCustomEditor(document: VTFDocument, webviewPanel: WebviewPanel, token: CancellationToken): void | Thenable<void> {

		webviewPanel.webview.options = {
			enableScripts: true
		}

		webviewPanel.webview.html = this.getWebviewContent(document, (path: string) => webviewPanel.webview.asWebviewUri(Uri.file(path)).toString())

		webviewPanel.onDidChangeViewState((e: WebviewPanelOnDidChangeViewStateEvent) => {
			if (e.webviewPanel.visible) {
				document.statusBarItem.show()
			}
			else {
				document.statusBarItem.hide()
			}
		})

		webviewPanel.webview.onDidReceiveMessage((message) => {
			document.onDidReceiveMessage(message)
			const state = message.state
			if ("flags" in state) {
				for (const id in state.flags) {
					const value = state.flags[id]
					document.changes++
					this.onDidChangeCustomDocumentEventEmitter.fire({
						document,
						label: `${value ? "enable" : "disable"} ${id}`,
						undo: () => {
							// @ts-ignore
							document.flags[id] = !value
							document.undo()
						},
						redo: () => {
							// @ts-ignore
							document.flags[id] = value
							document.redo()
						}
					})
				}
			}
		})

		// Update webview when the document tells us to
		// This gets invoked on fs.watch(...) change and vscode's "File: Revert File" command
		document.onShouldSendStateEventEmitter.event((e) => {
			webviewPanel.webview.postMessage({ state: e })
		})
	}

	private getWebviewContent(document: VTFDocument, createWebviewUri: (path: string) => string): string {
		return /* html */`
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>${document.uri.fsPath}</title>
				<style>
				* {
					margin: 0;
					padding: 0;
					box-sizing: border-box;
				}

				html,
				body {
					padding: 0;
					overflow: hidden;
					user-select: none;
					${document.isReadOnly ? "pointer-events: none" : ""}
				}

				div#container {
					margin: 0.25rem 0.5rem 0.5rem 0.5rem;
					height: calc(100vh - 1rem);
					display: grid;
					grid-template-columns: auto 1fr;
					grid-template-rows: auto minmax(0, 1fr);
					gap: 0.5rem;
				}

				fieldset {
					border-color: rgba(0, 0, 0, 0.2);
					border-radius: 3px;
					padding: 5px 0.5rem 0.5rem 0.5rem;
				}

				fieldset > legend {
					font-size: 14px;
					text-align: left;
					margin-left: 0.5rem;
				}

				fieldset > table {
					width: 50%;
					margin: 0;
				}

				div.checkbox-container {
					display: flex;
					align-items: center;
					gap: 5px;
					cursor: pointer;
				}

				div.checkbox-container > * {
					display: block;
				}

				div.checkbox-container > label {
					width: 100%;
					padding-right: 2.5rem;
					white-space: nowrap;
				}

				div.checkbox-container.disabled {
					opacity: 0.2;
					cursor: not-allowed;
				}

				div.checkbox-container.disabled > input[type="checkbox"],
				div.checkbox-container.disabled > label {
					pointer-events: none;
				}

				div#vtf-container {
					grid-row: span 2;
					margin-top: 8px;
					overflow: scroll;
				}

				canvas {
					--size: 90%;
					max-width: var(--size);
					max-height: var(--size);
					background-image: linear-gradient(45deg, rgb(20, 20, 20) 25%, transparent 25%, transparent 75%, rgb(20, 20, 20) 75%, rgb(20, 20, 20)), linear-gradient(45deg, rgb(20, 20, 20) 25%, transparent 25%, transparent 75%, rgb(20, 20, 20) 75%, rgb(20, 20, 20));
					background-position: 0 0, 8px 8px;
					background-size: 16px 16px;
					transform-origin: top left;
				}

				canvas.zoom-in {
					cursor: zoom-in;
				}

				canvas.zoom-out {
					cursor: zoom-out;
				}

				</style>
				<script>
				const state = new (class {

					#vscode
					#state
					#listeners

					get scale() { return this.#state.scale }
					set scale(value) {
						this.#state.scale = parseFloat(value.toFixed(1))
						const propertyChangedInfo = { scale: this.#state.scale }
						this.#onPropertyChanged(propertyChangedInfo)
						this.#setState(propertyChangedInfo)
					}

					constructor(state) {
						this.#vscode = acquireVsCodeApi()
						const { scale, flags } = this.#vscode.getState() ?? JSON.parse(\`${JSON.stringify({ scale: 1, flags: document.flags })}\`)
						this.#state = {
							scale: scale,
							flags: flags
						}
						this.flags = new Proxy(this.#state.flags, {
							get: (target, p) => {
								return target[p]
							},
							set: (target, p, value) => {
								target[p] = value
								const propertyChangedInfo = { flags: { [p]: value } }
								this.#onPropertyChanged(propertyChangedInfo)
								this.#setState(propertyChangedInfo)
								return target[p] == value
							}
						})
						this.#listeners = []
						addEventListener("message", (e) => {
							const message = event.data
							const state = message.state

							if (state.hasOwnProperty("scale")) {
								this.#state.scale = state.scale
								this.#onPropertyChanged({ scale: this.scale })
							}

							if (state.hasOwnProperty("flags")) {
								for (const id in state.flags) {
									this.#state.flags[id] = state.flags[id]
								}
								this.#onPropertyChanged({ flags: state.flags })
							}
						})

						// Update StatusBarItem with scale from vscode.getState()
						this.#setState({ scale: this.scale })
					}

					propertyChanged(listener) {
						this.#listeners.push(listener)
						return {
							unsubscribe: () => this.#listeners.remove(listener)
						}
					}

					#onPropertyChanged(propertyChangedInfo) {
						for (const listener of this.#listeners) {
							listener({ state: propertyChangedInfo })
						}
						this.#vscode.setState(this.#state)
					}

					#setState(propertyChangedInfo) {
						this.#vscode.postMessage({
							state: propertyChangedInfo
						})
					}
				})()
				</script>
			</head>
			<body>
				<div id="container">
					<div>
						<fieldset>
							<legend>File Info</legend>
							<table>
								<tr><td>Version:</td><td>${document.version}</td></tr>
								<tr><td>Format:</td><td>${document.imageFormat}</td></tr>
								<tr><td>Width:</td><td>${document.width}</td></tr>
								<tr><td>Height:</td><td>${document.height}</td></tr>
							</table>
						</fieldset>
					</div>
					<div id="vtf-container">
					</div>
					<div>
						<fieldset style="max-height: 100%">
						<legend>Flags</legend>
							<div style="max-height: 100%; overflow: hidden scroll">
								<script>
								document.write(Object.entries(state.flags).map(([k, v]) => \`<div class="checkbox-container\${v === null ? " disabled" : ""}"><input id="\${k}" type="checkbox" oninput="state.flags[this.id] = this.checked"\${v !== null && v ? " checked" :""}><label for="\${k}">\${v !== null ? k.split("-").map((w) => \`\${w[0].toUpperCase()}\${w.substring(1)}\`).join(" ") : "Unused"}</label></div>\`).join(""))
								state.propertyChanged((e) => {
									if (e.state.hasOwnProperty("flags")) {
										for (const id in e.state.flags) {
											document.getElementById(id).checked = state.flags[id]
										}
									}
								})
							</script>
							</div>
						</fieldset>
					</div>
				</div>
				<script src="${createWebviewUri(join(this.context.extensionPath, "node_modules", "tga-js", "dist", "umd", "tga.js"))}"></script>
				<script>
					const tga = new TgaLoader()
					tga.open("${createWebviewUri(document.tgaPath)}", () => {
						const canvas = tga.getCanvas()
						canvas.classList.add("zoom-in")

						const updateTransform = () => {
							canvas.style.transform = \`scale(\${state.scale})\`
						}

						state.propertyChanged((e) => {
							if (e.state.hasOwnProperty("scale")) {
								updateTransform()
							}
						})

						updateTransform()

						canvas.addEventListener("click", (/** @type {MouseEvent} */ e) => {
							if (e.ctrlKey) {
								// Zoom Out
								if (state.scale > 0.1) {
									state.scale -= 0.1
								}
							}
							else {
								// Zoom In
								if (state.scale < 10) {
									state.scale += 0.1
								}
							}
						})

						addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
							if (e.code == "ControlLeft" || e.code == "ControlRight") {
								canvas.classList.remove("zoom-in")
								canvas.classList.add("zoom-out")
							}
						})

						addEventListener("keyup", (/** @type {KeyboardEvent} */ e) => {
							if (e.code == "ControlLeft" || e.code == "ControlRight") {
								canvas.classList.remove("zoom-out")
								canvas.classList.add("zoom-in")
							}
						})

						addEventListener("wheel", (/** @type {WheelEvent} */ e) => {
							if (e.ctrlKey) {
								if (e.deltaY < 0) {
									// Zoom In
									if (state.scale < 2) {
										state.scale += 0.1
									}
								}
								else {
									// Zoom Out
									if (state.scale > 0.1) {
										state.scale -= 0.1
									}
								}
							}
						})

						document.getElementById("vtf-container").appendChild(canvas)
					})
				</script>
			</body>
		</html>
		`
	}
}
