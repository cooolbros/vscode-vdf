import { initTRPC, type AnyRouter } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import { devalueTransformer } from "common/devalueTransformer"
import type { LanguageNames } from "utils/types/LanguageNames"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "utils/types/VSCodeVDFLanguageID"
import type { BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import { TRPCClientRouter } from "./TRPCClientRouter"
import { FileSystemMountPointFactory } from "./VirtualFileSystem/FileSystemMountPointFactory"

export class Client {

	private static readonly TRPCRequestSchema = z.tuple([
		z.union([
			z.literal("hudanimations"),
			z.literal("popfile"),
			z.literal("vmt"),
			z.literal("vdf"),
			z.null()
		]),
		z.tuple([
			z.string(),
			z.object({
				method: z.string(),
				headers: z.record(z.string()),
				body: z.string().optional()
			})
		])
	])

	private static readonly FileSystemMountPointFactory = new FileSystemMountPointFactory()

	private readonly client: BaseLanguageClient
	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly subscriptions: { dispose(): any }[]

	constructor(languageClients: { -readonly [P in keyof LanguageNames]?: Client }, startServer: (languageId: VSCodeVDFLanguageID) => void, client: BaseLanguageClient) {
		this.client = client
		this.startServer = startServer
		this.subscriptions = []

		let router: ReturnType<typeof TRPCClientRouter>

		this.subscriptions.push(this.client.onRequest("vscode-vdf/trpc", async (params: unknown) => {
			const [languageId, [url, init]] = Client.TRPCRequestSchema.parse(params)

			if (languageId == null) {
				router ??= TRPCClientRouter(
					initTRPC.create({ transformer: devalueTransformer }),
					Client.FileSystemMountPointFactory
				)

				const response = await fetchRequestHandler<AnyRouter>({
					endpoint: "",
					req: new Request(new URL(url, "https://vscode.vdf"), init),
					router: router
				})

				return await response.text()
			}
			else {
				const languageClient = languageClients[languageId]
				if (!languageClient) {
					throw new Error(`${languageId} language server not running.`)
				}
				return languageClient.client.sendRequest("vscode-vdf/trpc", [url, init])
			}
		}))
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
