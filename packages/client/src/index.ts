import { initTRPC, type AnyTRPCRouter } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { devalueTransformer } from "common/devalueTransformer"
import type { Uri } from "common/Uri"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import type { Observable } from "rxjs"
import type { ExtensionContext } from "vscode"
import { type BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import { TRPCClientRouter } from "./TRPCClientRouter"
import type { FileSystemMountPoint } from "./VirtualFileSystem/FileSystemMountPoint"
import { FileSystemMountPointFactory } from "./VirtualFileSystem/FileSystemMountPointFactory"

export * from "common/VSCodeVDFLanguageID"

export class Client<T extends BaseLanguageClient> {

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

	private static fileSystemMountPointFactory?: FileSystemMountPointFactory

	public readonly client: T
	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly subscriptions: { dispose(): any }[]
	private router?: ReturnType<typeof TRPCClientRouter>

	constructor(
		context: ExtensionContext,
		languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<T> },
		startServer: (languageId: VSCodeVDFLanguageID) => void,
		teamFortress2Folder$: Observable<Uri>,
		teamFortress2FileSystemFactory: Record<string, (teamFortress2Folder: Uri, factory: FileSystemMountPointFactory) => Promise<FileSystemMountPoint>>,
		client: T,
	) {
		this.client = client
		this.startServer = startServer
		this.subscriptions = []

		this.subscriptions.push(
			this.client.onRequest("vscode-vdf/trpc", async (params: unknown) => {
				const [languageId, [url, init]] = Client.TRPCRequestSchema.parse(params)

				if (languageId == null) {
					Client.fileSystemMountPointFactory ??= new FileSystemMountPointFactory(teamFortress2FileSystemFactory)
					this.router ??= TRPCClientRouter(
						initTRPC.create({
							transformer: devalueTransformer({
								reducers: {},
								revivers: {},
								name: null,
								subscriptions: this.subscriptions,
								onRequest: (method, handler) => client.onRequest(method, handler),
								onNotification: (method, handler) => client.onNotification(method, handler),
								sendRequest: (server, method, param) => {
									throw new Error(`server == null (${server}, ${method}, ${JSON.stringify(param)})`)
								},
								sendNotification: async (server, method, param) => {
									await languageClients[server]!.client.sendNotification(method, param)
								},
							}),
							isDev: true,
						}),
						context,
						teamFortress2Folder$,
						Client.fileSystemMountPointFactory
					)

					const response = await fetchRequestHandler<AnyTRPCRouter>({
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
			this.client.onNotification("vscode-vdf/sendNotification", async (...params) => {
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
