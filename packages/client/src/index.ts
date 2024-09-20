import type { AnyRouter } from "@trpc/server"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import type { LanguageNames } from "utils/types/LanguageNames"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "utils/types/VSCodeVDFLanguageID"
import { Position, Range, window, type DecorationInstanceRenderOptions, type DecorationOptions } from "vscode"
import type { BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import { clientRouter } from "./TRPCClientRouter"

type JSONDecorationOptions = {
	range: JSONRange
	renderOptions?: DecorationInstanceRenderOptions
}
type JSONRange = { start: JSONPosition, end: JSONPosition }
type JSONPosition = { line: number, character: number }

export class Client {

	private static readonly sendRequestParamsSchema = z.tuple([VSCodeVDFLanguageIDSchema, z.string(), z.record(z.unknown())])
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

	private readonly client: BaseLanguageClient
	private readonly startServer: (languageId: VSCodeVDFLanguageID) => void
	private readonly subscriptions: { dispose(): any }[]

	constructor(languageClients: { -readonly [P in keyof LanguageNames]?: Client }, startServer: (languageId: VSCodeVDFLanguageID) => void, client: BaseLanguageClient) {
		this.client = client
		this.startServer = startServer
		this.subscriptions = []

		this.subscriptions.push(this.client.onRequest("vscode-vdf/trpc", async (params: unknown) => {
			const [languageId, [url, init]] = Client.TRPCRequestSchema.parse(params)

			if (languageId == null) {
				const response = await fetchRequestHandler<AnyRouter>({
					endpoint: "",
					req: new Request(new URL(url, "https://vscode.vdf"), init),
					router: clientRouter
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

		const hudAnimationsEventDecorationType = window.createTextEditorDecorationType({
			after: {
				margin: "0 0 0 0.5rem",
				color: "#99999959",
			}
		})

		const editorDecorationss = new Map<string, DecorationOptions[]>()

		this.subscriptions.push(
			window.onDidChangeActiveTextEditor((editor) => {
				if (!editor) {
					return
				}

				const decorations = editorDecorationss.get(editor.document.uri.toString())
				if (decorations) {
					editor.setDecorations(hudAnimationsEventDecorationType, decorations)
				}
			}),
			this.client.onRequest("textDocument/decoration", ([uri, decorations]: [string, JSONDecorationOptions[]]) => {

				const editor = window.visibleTextEditors.find((editor) => editor.document.uri.toString() == uri)
				if (!editor) {
					return
				}

				const editorDecorations = decorations.map((decoration) => {
					const range = decoration.range
					return {
						range: new Range(new Position(range.start.line, range.start.character), new Position(range.end.line, range.end.character)),
						renderOptions: decoration.renderOptions
					}
				})

				editorDecorationss.set(editor.document.uri.toString(), editorDecorations)

				editor?.setDecorations(
					hudAnimationsEventDecorationType,
					editorDecorations
				)
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
