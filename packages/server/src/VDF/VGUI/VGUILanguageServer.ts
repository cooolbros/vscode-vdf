import type { initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { DataTransformer } from "@trpc/server/unstable-core-do-not-import"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { Uri } from "common/Uri"
import { map, shareReplay } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { type Connection } from "vscode-languageserver"
import { z } from "zod"
import { Definitions, References } from "../../DefinitionReferences"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { VGUITextDocument, type VGUITextDocumentDependencies } from "./VGUITextDocument"
import { VGUIWorkspace } from "./VGUIWorkspace"

export class VGUILanguageServer extends VDFLanguageServer<
	"vdf",
	VGUITextDocument,
	VGUITextDocumentDependencies
> {

	private readonly workspaces: Map<string, Promise<VGUIWorkspace>>

	private readonly teamFortress2Folder$ = fromTRPCSubscription(this.trpc.client.teamFortress2FileSystem.teamFortress2Folder, undefined).pipe(
		shareReplay({ bufferSize: 1, refCount: true })
	)

	constructor(languageId: "vdf", name: "VDF", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vdf",
			platform: platform,
			servers: new Set(["hudanimations"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const paths: ({ type: "tf2" } | { type: "folder", uri: Uri })[] = []

				const [workspaceUris, hudRoot] = await Promise.all([
					this.workspaceUris,
					this.trpc.client.searchForHUDRoot.query({ uri: init.uri })
				])

				if (hudRoot != null) {
					paths.push({ type: "folder", uri: hudRoot })
				}

				paths.push({ type: "tf2" })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", uri: workspaceUri })))

				let workspace: Promise<VGUIWorkspace> | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = Promise.resolve(new VGUIWorkspace({
							uri: hudRoot,
							fileSystem: await this.fileSystems.get(paths),
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
					this.teamFortress2Folder$,
					await this.fileSystems.get(paths),
					(uri) => fromTRPCSubscription(this.trpc.client.workspace.createFileSystemWatcher, { uri }),
					this.documents,
					await workspace,
				)
			}
		})

		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: DataTransformer }>>) {
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
					clientScheme: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
							})
						)
						.subscription(async ({ input, signal }) => {
							const workspace = await this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							return observableToAsyncIterable<Definitions>(
								workspace.clientScheme$.pipe(
									map((definitionReferences) => definitionReferences.definitions)
								),
								signal!
							)
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

							return observableToAsyncIterable<{ uri: Uri, definitions: Definitions } | null>(
								workspace.getDefinitionReferences(input.path),
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
