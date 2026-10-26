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
import { firstValueFrom } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import vscode from "vscode"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import type { Decorations } from "./Decorations"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { searchForHUDRoot } from "./searchForHUDRoot"
import { TRPCClientRouter } from "./TRPCClientRouter"

export * from "common/VSCodeVDFLanguageID"

export class Client<T extends BaseLanguageClient> extends AsyncDisposableBase {

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
		decorations: Decorations,
		fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>,
		fileSystemWatcherFactory: FileSystemWatcherFactory,
		bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
		client: T,
	) {
		super()

		this.client = this.stack.adopt(client, async (disposable) => await disposable.dispose())

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
	}

	public async start(): Promise<void> {
		await this.client.start()
	}
}
