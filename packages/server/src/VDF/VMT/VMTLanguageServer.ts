import type { TRPCCombinedDataTransformer, initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { usingAsync } from "common/operators/usingAsync"
import { Uri } from "common/Uri"
import { combineLatest, of, switchMap } from "rxjs"
import { type Connection } from "vscode-languageserver"
import { z } from "zod"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { resolveFileDetail } from "../VDFTextDocument"
import { VMTTextDocument } from "./VMTTextDocument"
import { VMTWorkspace } from "./VMTWorkspace"

export class VMTLanguageServer extends VDFLanguageServer<"vmt", VMTTextDocument> {

	private readonly workspaces: Map<string, VMTWorkspace>

	constructor(languageId: "vmt", name: "VMT", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vmt",
			platform: platform,
			servers: new Set(),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem = await this.fileSystems.get([
					...(hudRoot ? [{ type: <const>"folder", uri: hudRoot }] : []),
					{ type: "tf2" }
				])

				let workspace: VMTWorkspace | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = new VMTWorkspace(hudRoot, fileSystem, this.documents)
						this.workspaces.set(key, w)
					}
					workspace = w
				}
				else {
					const key = "tf2"
					let w = this.workspaces.get(key)
					if (!w) {
						w = new VMTWorkspace(new Uri({ scheme: "file", path: "/" }), fileSystem, this.documents)
						this.workspaces.set(key, w)
					}
					workspace = w
				}

				return new VMTTextDocument(
					init,
					documentConfiguration$,
					fileSystem,
					this.documents,
					workspace,
				)
			}
		})
		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>) {
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

											const baseTexture = header.find((documentSymbol) => documentSymbol.key.toLowerCase() == "$baseTexture".toLowerCase())?.detail
											if (!baseTexture) {
												return of(null)
											}

											const path = resolveFileDetail(baseTexture, dependencies.schema.files.find(({ keys }) => keys.has("$baseTexture".toLowerCase()))!)
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
