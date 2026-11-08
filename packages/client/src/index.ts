import { initTRPC } from "@trpc/server"
import type { BSP } from "bsp"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemKey } from "common/FileSystemKey"
import { EntryType, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import { Uri } from "common/Uri"
import { posix } from "path"
import { combineLatest, firstValueFrom, map, Observable, of } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import vscode from "vscode"
import { State, type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import { displayName, name } from "../../../package.json"
import type { Decorations } from "./Decorations"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { RemoteResourceFileSystemProvider } from "./RemoteResourceFileSystemProvider"
import { searchForHUDRoot } from "./searchForHUDRoot"
import { TRPCClientRouter } from "./TRPCClientRouter"

export * from "common/VSCodeVDFLanguageID"

export type TeamFortress2FolderResult = (
	| { type: "success", uri: Uri }
	| { type: "empty" }
	| { type: "error", setting: string }
)

export interface Restart<T extends BaseLanguageClient> {
	restart(client: T): Promise<void>
}

export class Client<T extends BaseLanguageClient> extends AsyncDisposableBase implements vscode.Disposable {

	public static readonly documentSelector = [
		{ language: "hudanimations" },
		{ language: "popfile" },
		{ language: "vdf" },
		{ language: "vmt" },
	]

	public static async onDidOpenPlainTextTextDocument(document: vscode.TextDocument, fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>) {
		const uri = new Uri(document.uri)
		const hudRoot = await searchForHUDRoot(uri)
		if (hudRoot == null) {
			return
		}

		await using fileSystem = await fileSystemMountPointFactory.get({ type: "folder", folder: hudRoot })
		const entry = await firstValueFrom(fileSystem.resolve("scripts/hudanimations_manifest.txt"))
		if (entry.type != EntryType.File) {
			return
		}

		try {
			const buf = await vscode.workspace.fs.readFile(entry.uri)
			const text = new TextDecoder("utf-8").decode(buf)
			const documentSymbols = getVDFDocumentSymbols(text, { multilineStrings: false })
			const manifest = (documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children ?? [])
				.values()
				.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "file" && documentSymbol.value?.text.trim().length)
				.map((documentSymbol) => posix.resolve(`/${documentSymbol.value!.text}`).substring(1).toLowerCase())
				.toArray()

			if (manifest.includes(hudRoot.relative(uri).toLowerCase())) {
				vscode.languages.setTextDocumentLanguage(document, "hudanimations")
			}
		}
		catch { }
	}

	public readonly client: T

	public constructor(
		context: vscode.ExtensionContext,
		result$: Observable<TeamFortress2FolderResult>,
		decorations: Decorations,
		fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>,
		fileSystemWatcherFactory: FileSystemWatcherFactory,
		bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
		client: T,
		restartService: Restart<T>
	) {
		super()

		this.client = this.stack.adopt(client, async (disposable) => await disposable.dispose())

		this.stack.adopt(
			vscode.commands.registerCommand("vscode-vdf.showOutputChannel", () => this.client.outputChannel.show()),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			vscode.commands.registerCommand("vscode-vdf.startVDFLanguageServer", async () => await this.client.start()),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			vscode.commands.registerCommand("vscode-vdf.stopVDFLanguageServer", async () => await this.client.stop()),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			vscode.commands.registerCommand("vscode-vdf.restartVDFLanguageServer", async () => await restartService.restart(this.client)),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			this.client.onRequest("vscode-vdf/trpc", TRPCRequestHandler({
				router: TRPCClientRouter(
					initTRPC
						.context<{ client: "vdf" }>()
						.create({
							transformer: devalueTransformer({
								reducers: {
									Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
									VDFPosition: (value: unknown) => value instanceof VDFPosition ? value.toJSON() : undefined,
									VDFRange: (value: unknown) => value instanceof VDFRange ? value.toJSON() : undefined,
								},
								revivers: {
									Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
									VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
								}
							}),
							isDev: true,
						}),
					context,
					decorations,
					fileSystemMountPointFactory,
					fileSystemWatcherFactory,
					bspFactory
				),
				schema: z.enum(["vdf"]),
				stack: this.stack,
				sendNotification: async (server, method, param) => {
					await client.sendNotification(method, param)
				}
			})),
			(disposable) => disposable.dispose()
		)

		const statusBarItem = this.stack.adopt(vscode.window.createStatusBarItem("vscode-vdf.statusBarItem", vscode.StatusBarAlignment.Left), (disposable) => disposable.dispose())
		statusBarItem.text = `$(loading~spin) ${name}`
		statusBarItem.show()

		const statusBarItem$ = combineLatest({
			version: of(context.extension.packageJSON.version),
			result: result$,
			state: new Observable<State>((subscriber) => {
				subscriber.next(this.client.state)
				const disposable = this.client.onDidChangeState((event) => subscriber.next(event.newState))
				return () => disposable.dispose()
			})
		}).pipe(
			map(({ version, result, state }) => {
				let text: string
				let backgroundColor: vscode.ThemeColor | undefined = undefined

				switch (state) {
					case State.Stopped:
						text = `$(circle-slash) ${name}`
						break
					case State.Running:
						text = name
						backgroundColor = undefined
						break
					case State.Starting:
						text = `$(loading~spin) ${name}`
						backgroundColor = undefined
						break
					case State.StartFailed:
						text = `$(error) ${name}`
						backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground")
						break
				}

				// https://code.visualstudio.com/api/references/theme-color#status-bar-colors
				switch (result.type) {
					case "success":
						backgroundColor = undefined
						break
					case "empty":
						backgroundColor = undefined
						break
					case "error":
						backgroundColor ??= new vscode.ThemeColor("statusBarItem.warningBackground")
						break
				}

				// https://code.visualstudio.com/api/extension-guides/command#command-uris
				const command = (name: string, ...args: any[]) => {
					return vscode.Uri.parse(`command:${name}${args.length ? `?${encodeURIComponent(JSON.stringify(args))}` : ""}`).toString()
				}

				const lines = [
					`### ${displayName} ${version}`,
					`---`,
					`[$(github-inverted) Github](https://github.com/cooolbros/vscode-vdf)`,
					`[$(globe) Documentation](https://cooolbros.github.io/vscode-vdf/)`,
					`[$(vscode-insiders-outline) VS Marketplace](https://marketplace.visualstudio.com/items?itemName=pfwobcke.vscode-vdf)`,
					`[$(code-oss) Open VSX Registry](https://open-vsx.org/extension/pfwobcke/vscode-vdf)`,
					`---`,
					`[$(terminal) Open Output Channel](${command("vscode-vdf.showOutputChannel")})`,
					this.client.isRunning()
						? `[$(stop-circle) Stop Server](${command("vscode-vdf.stopVDFLanguageServer")})`
						: `[$(play-circle) Start Server](${command("vscode-vdf.startVDFLanguageServer")})`,
					`[$(debug-restart~spin) Restart Server](${command("vscode-vdf.restartVDFLanguageServer")})`,
					`---`,
					`[$(settings-gear) Open Settings](${command("workbench.action.openSettings", `@ext:${context.extension.id}`)})`,
					(() => {
						switch (result.type) {
							case "success": return `$(folder-active) \`${result.uri.fsPath.replace(/[a-z]{1}:/i, (substring) => substring.toUpperCase())}\``
							case "empty": return `$(cloud) ${RemoteResourceFileSystemProvider.base}`
							case "error": return `$(cloud) ${RemoteResourceFileSystemProvider.base}`
						}
					})(),
				]

				const tooltip = new vscode.MarkdownString(lines.join("\n\n"), true)
				tooltip.isTrusted = true

				return {
					text,
					tooltip,
					backgroundColor,
				}
			})
		)

		this.stack.adopt(
			statusBarItem$.subscribe(({ text, tooltip, backgroundColor }) => {
				statusBarItem.text = text
				statusBarItem.tooltip = tooltip
				statusBarItem.backgroundColor = backgroundColor
			}),
			(subscription) => subscription.unsubscribe()
		)
	}

	public async start(): Promise<void> {
		await this.client.start()
	}

	public dispose() {
		void this[Symbol.asyncDispose]()
	}
}
