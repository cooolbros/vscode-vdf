import { initTRPC } from "@trpc/server"
import type { BSP } from "bsp"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemKey } from "common/FileSystemKey"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import { Uri } from "common/Uri"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { VDFPosition, VDFRange } from "vdf"
import vscode from "vscode"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { TRPCClientRouter } from "./TRPCClientRouter"

export * from "common/VSCodeVDFLanguageID"

export class Client<T extends BaseLanguageClient> extends AsyncDisposableBase {

	private static readonly sendSchema = z.object({
		server: VSCodeVDFLanguageIDSchema,
		method: z.string(),
		param: z.any()
	})

	public readonly client: T

	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly router: ReturnType<typeof TRPCClientRouter>

	constructor(
		context: vscode.ExtensionContext,
		languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<T> },
		startServer: (languageId: VSCodeVDFLanguageID) => void,
		fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>,
		fileSystemWatcherFactory: FileSystemWatcherFactory,
		bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
		client: T,
	) {
		super()

		this.client = this.stack.adopt(client, (disposable) => disposable.dispose())
		this.startServer = startServer
		this.router = TRPCClientRouter(
			initTRPC
				.context<{ client: VSCodeVDFLanguageID }>()
				.create({
					transformer: devalueTransformer({
						reducers: {
							Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
						},
						revivers: {
							Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
							VDFPosition: (value: ReturnType<VDFPosition["toJSON"]>) => VDFPosition.schema.parse(value),
							VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
						}
					}),
					isDev: true,
				}),
			context,
			fileSystemMountPointFactory,
			fileSystemWatcherFactory,
			bspFactory
		)

		this.stack.adopt(
			this.client.onRequest("vscode-vdf/trpc", TRPCRequestHandler({
				router: this.router,
				schema: VSCodeVDFLanguageIDSchema,
				onRequest: (method, handler) => this.stack.adopt(this.client.onRequest(method, handler), (disposable) => disposable.dispose()),
				sendNotification: async (server, method, param) => {
					await languageClients[server]!.client.sendNotification(method, param)
				}
			})),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			this.client.onRequest("vscode-vdf/sendRequest", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				return await languageClients[server]!.client.sendRequest(method, param)
			}),
			(disposable) => disposable.dispose()
		)

		this.stack.adopt(
			this.client.onNotification("vscode-vdf/sendNotification", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				await languageClients[server]!.client.sendNotification(method, param)
			}),
			(disposable) => disposable.dispose()
		)
	}

	public async start(): Promise<Record<string, unknown>> {
		await this.client.start()

		const { servers, ...rest } = z.looseObject({
			servers: z.array(VSCodeVDFLanguageIDSchema).transform((arg) => new Set(arg))
		}).parse(this.client.initializeResult?.["data"])

		for (const languageId of servers) {
			this.startServer(languageId)
		}

		return rest
	}
}
