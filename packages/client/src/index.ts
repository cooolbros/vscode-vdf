import { initTRPC, type AnyRouter } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { devalueTransformer } from "common/devalueTransformer"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import { TRPCClientRouter } from "./TRPCClientRouter"
import { FileSystemMountPointFactory } from "./VirtualFileSystem/FileSystemMountPointFactory"

export * from "common/VSCodeVDFLanguageID"

export class Client {

	private static readonly TRPCRequestSchema = z.tuple([
		VSCodeVDFLanguageIDSchema.nullable(),
		z.tuple([
			z.string(),
			z.object({
				method: z.string(),
				headers: z.record(z.string()),
				body: z.string().optional()
			})
		])
	])

	private static readonly sendSchema = z.object({
		server: VSCodeVDFLanguageIDSchema,
		method: z.string(),
		param: z.any()
	})

	private static readonly FileSystemMountPointFactory = new FileSystemMountPointFactory()

	private readonly client: BaseLanguageClient
	private router?: ReturnType<typeof TRPCClientRouter>
	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly subscriptions: { dispose(): any }[]

	constructor(
		languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client },
		startServer: (languageId: VSCodeVDFLanguageID) => void,
		subscriptions: { dispose(): any }[],
		client: BaseLanguageClient,
	) {
		this.client = client
		this.startServer = startServer
		this.subscriptions = []

		this.subscriptions.push(
			this.client.onRequest("vscode-vdf/trpc", async (params: unknown) => {
				const [languageId, [url, init]] = Client.TRPCRequestSchema.parse(params)

				if (languageId == null) {
					this.router ??= TRPCClientRouter(
						initTRPC.create({
							transformer: devalueTransformer({
								reducers: {},
								revivers: {},
								name: "client",
								subscriptions: subscriptions,
								onRequest: (method, handler) => client.onRequest(method, handler),
								onNotification: (method, handler) => client.onNotification(method, handler),
								sendRequest: (server, method, param) => {
									if (server != null) {
										languageClients[VSCodeVDFLanguageIDSchema.parse(server)]!.client.sendRequest(method, param)
									}
									throw new Error("server == null")
								},
								sendNotification: (server, method, param) => {
									if (server != null) {
										languageClients[VSCodeVDFLanguageIDSchema.parse(server)]!.client.sendNotification(method, param)
									}
									throw new Error("server == null")
								},
							})
						}),
						Client.FileSystemMountPointFactory
					)

					const response = await fetchRequestHandler<AnyRouter>({
						endpoint: "",
						req: new Request(new URL(url, "https://vscode.vdf"), init),
						router: this.router
					})

					return await response.text()
				}
				else {
					return await languageClients[languageId]!.client.sendRequest("vscode-vdf/trpc", [url, init])
				}
			}),
			this.client.onRequest("vscode-vdf/sendRequest", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				return await languageClients[server]!.client.sendRequest(method, param)
			}),
			this.client.onRequest("vscode-vdf/sendNotification", async (...params) => {
				const { server, method, param } = Client.sendSchema.parse(params[0])
				return await languageClients[server]!.client.sendNotification(method, param)
			})
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
		for (const subscription of this.subscriptions) {
			subscription.dispose()
		}
	}
}
