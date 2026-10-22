import { initTRPC } from "@trpc/server"
import type { BSP } from "bsp"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemKey } from "common/FileSystemKey"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import { Uri } from "common/Uri"
import { VDFPosition, VDFRange } from "vdf"
import vscode from "vscode"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import type { Decorations } from "./Decorations"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { TRPCClientRouter } from "./TRPCClientRouter"

export * from "common/VSCodeVDFLanguageID"

export class Client<T extends BaseLanguageClient> extends AsyncDisposableBase {

	public static readonly documentSelector = [
		{ language: "hudanimations" },
		{ language: "popfile" },
		{ language: "vdf" },
		{ language: "vmt" },
	]

	public readonly client: T

	constructor(
		context: vscode.ExtensionContext,
		decorations: Decorations,
		fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>,
		fileSystemWatcherFactory: FileSystemWatcherFactory,
		bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
		client: T,
	) {
		super()

		this.client = this.stack.adopt(client, (disposable) => disposable.dispose())

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
