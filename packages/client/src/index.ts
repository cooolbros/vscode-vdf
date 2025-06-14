import { initTRPC } from "@trpc/server"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import type { Uri } from "common/Uri"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import type { Observable } from "rxjs"
import type { ExtensionContext } from "vscode"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { TRPCClientRouter } from "./TRPCClientRouter"

export * from "common/VSCodeVDFLanguageID"

export class Client<T extends BaseLanguageClient> {

	private static readonly sendSchema = z.object({
		server: VSCodeVDFLanguageIDSchema,
		method: z.string(),
		param: z.any()
	})

	public readonly client: T

	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly router: ReturnType<typeof TRPCClientRouter>
	private readonly stack: DisposableStack

	constructor(
		context: ExtensionContext,
		languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<T> },
		startServer: (languageId: VSCodeVDFLanguageID) => void,
		teamFortress2Folder$: Observable<Uri>,
		fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>,
		fileSystemWatcherFactory: FileSystemWatcherFactory,
		client: T,
	) {
		this.client = client
		this.startServer = startServer
		this.router = TRPCClientRouter(
			initTRPC.create({
				transformer: devalueTransformer({ reducers: {}, revivers: {} }),
				isDev: true,
			}),
			context,
			teamFortress2Folder$,
			fileSystemMountPointFactory,
			fileSystemWatcherFactory
		)

		const stack = this.stack = new DisposableStack()
		stack.adopt(this.client, (disposable) => disposable.dispose())

		stack.adopt(
			this.client.onRequest("vscode-vdf/trpc", TRPCRequestHandler({
				router: this.router,
				schema: VSCodeVDFLanguageIDSchema,
				onRequest: (method, handler) => stack.adopt(this.client.onRequest(method, handler), (disposable) => disposable.dispose()),
				sendNotification: async (server, method, param) => {
					await languageClients[server]!.client.sendNotification(method, param)
				}
			})),
			(disposable) => disposable.dispose()
		)

		stack.adopt(
			this.client.onRequest("vscode-vdf/sendRequest", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				return await languageClients[server]!.client.sendRequest(method, param)
			}),
			(disposable) => disposable.dispose()
		)

		stack.adopt(
			this.client.onNotification("vscode-vdf/sendNotification", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				await languageClients[server]!.client.sendNotification(method, param)
			}),
			(disposable) => disposable.dispose()
		)
	}

	public async start(): Promise<void> {
		return this.client.start().then(() => {
			const result = VSCodeVDFLanguageIDSchema.array().transform((arg) => new Set(arg)).safeParse(this.client.initializeResult?.["servers"])
			if (result.success) {
				for (const languageId of result.data) {
					this.startServer(languageId)
				}
			}
			else {
				this.client.warn(result.error.message)
			}
		})
	}

	public dispose() {
		this.stack.dispose()
	}
}
