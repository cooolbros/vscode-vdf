import type { initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { DataTransformer } from "@trpc/server/unstable-core-do-not-import"
import { usingAsync } from "common/operators/usingAsync"
import { Uri } from "common/Uri"
import { posix } from "path"
import { combineLatest, of, switchMap } from "rxjs"
import { type Connection } from "vscode-languageserver"
import { z } from "zod"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { VMTTextDocument, type VMTTextDocumentDependencies } from "./VMTTextDocument"
import { VMTWorkspace } from "./VMTWorkspace"

export class VMTLanguageServer extends VDFLanguageServer<
	"vmt",
	VMTTextDocument,
	VMTTextDocumentDependencies
> {

	private readonly workspaces: Map<string, VMTWorkspace>

	constructor(languageId: "vmt", name: "VMT", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vmt",
			platform: platform,
			servers: new Set(),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const [workspaceUris, hudRoot] = await Promise.all([
					this.workspaceUris,
					this.trpc.client.searchForHUDRoot.query({ uri: init.uri })
				])

				const paths: ({ type: "tf2" } | { type: "folder", uri: Uri })[] = []

				if (hudRoot != null) {
					paths.push({ type: "folder", uri: hudRoot })
				}

				paths.push({ type: "tf2" })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", uri: workspaceUri })))

				const key = hudRoot?.toString() ?? "tf2"
				let workspace = this.workspaces.get(key)
				if (!workspace) {
					workspace = new VMTWorkspace(hudRoot ?? new Uri({ scheme: "file", path: "/" }), await this.fileSystems.get(paths), this.documents)
					this.workspaces.set(key, workspace)
				}

				return new VMTTextDocument(
					init,
					documentConfiguration$,
					await this.fileSystems.get(paths),
					this.documents,
					workspace,
				)
			}
		})
		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: DataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				baseTexture: t
					.procedure
					.input(
						z.object({
							uri: Uri.schema,
						})
					)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<Uri | null>(
							usingAsync(async () => await this.documents.get(input.uri)).pipe(
								switchMap((document) => {
									return combineLatest({
										documentSymbols: document.documentSymbols$,
										dependencies: document.configuration.dependencies$
									}).pipe(
										switchMap(({ documentSymbols, dependencies }) => {
											const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children
											if (!header) {
												return of(null)
											}

											let baseTexture = header.find((documentSymbol) => documentSymbol.key.toLowerCase() == "$baseTexture".toLowerCase())?.detail
											if (!baseTexture) {
												return of(null)
											}

											baseTexture = baseTexture.replaceAll(/[/\\]+/g, "/")
											if (posix.extname(baseTexture) != ".vtf") {
												baseTexture += ".vtf"
											}

											const path = posix.resolve(`/materials/${baseTexture}`).substring(1)
											return document.fileSystem.resolveFile(path)
										})
									)
								}),
							),
							signal!
						)
					})
			})
		)
	}
}
