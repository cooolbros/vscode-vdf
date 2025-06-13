import type { initTRPC, TRPCCombinedDataTransformer } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { Uri } from "common/Uri"
import { map, Observable } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { type Connection } from "vscode-languageserver"
import { z } from "zod"
import { Definitions, References } from "../../DefinitionReferences"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { VGUITextDocument } from "./VGUITextDocument"
import { VGUIWorkspace } from "./VGUIWorkspace"

export class VGUILanguageServer extends VDFLanguageServer<"vdf", VGUITextDocument> {

	private readonly workspaces: Map<string, Promise<VGUIWorkspace>>

	constructor(languageId: "vdf", name: "VDF", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vdf",
			platform: platform,
			servers: new Set(["hudanimations"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem = await this.fileSystems.get([
					{ type: "folder", uri: hudRoot ?? init.uri.dirname() },
					{ type: "tf2" },
				])

				let workspace: Promise<VGUIWorkspace> | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = Promise.resolve(new VGUIWorkspace({
							uri: hudRoot,
							fileSystem: fileSystem,
							documents: this.documents,
							request: this.trpc.servers.hudanimations.workspace.open.mutate({ uri: hudRoot })
						}))
						this.workspaces.set(key, w)
					}
					workspace = w
				}
				else {
					workspace = null
				}

				return new VGUITextDocument(
					init,
					documentConfiguration$,
					new Observable<Uri>((subscriber) => {
						return this.trpc.client.teamFortress2FileSystem.teamFortress2Folder.subscribe(undefined, {
							onData: (value) => subscriber.next(value),
							onError: (err) => subscriber.error(err),
							onComplete: () => subscriber.complete(),
						})
					}),
					fileSystem,
					this.documents,
					await workspace,
				)
			}
		})

		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				workspace: {
					open: t
						.procedure
						.input(
							z.object({
								uri: Uri.schema,
							})
						)
						.mutation(async ({ input }) => {
							if (!this.workspaces.has(input.uri.toString())) {
								this.workspaces.set(
									input.uri.toString(),
									Promise.try(async () => new VGUIWorkspace({
										uri: input.uri,
										fileSystem: await this.fileSystems.get([
											{ type: "folder", uri: input.uri },
											{ type: "tf2" }
										]),
										documents: this.documents,
										request: Promise.resolve()
									}))
								)
							}
						}),
					documentSymbol: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								path: z.string(),
							})
						)
						.subscription(async ({ input, signal }) => {
							const workspace = await this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							return observableToAsyncIterable<VDFDocumentSymbols | null>(workspace.getVDFDocumentSymbols(input.path), signal!)
						}),
					definitions: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								path: z.string(),
							})
						)
						.subscription(async ({ input, signal }) => {
							const workspace = await this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							return observableToAsyncIterable<Definitions | null>(
								workspace.getDefinitionReferences(input.path).pipe(
									map((definitionReferences) => definitionReferences?.definitions ?? null)
								),
								signal!
							)
						}),
					setFilesReferences: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								references: z.map(z.string(), z.map(z.string(), z.instanceof(References).nullable()))
							})
						)
						.mutation(async ({ input }) => {
							const workspace = await this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							for (const [path, documentReferences] of input.references) {
								workspace.setFileReferences(path, documentReferences)
							}
						})
				}
			})
		)
	}
}
