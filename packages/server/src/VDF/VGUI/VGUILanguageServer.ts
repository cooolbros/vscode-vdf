import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { Uri } from "common/Uri"
import { map } from "rxjs"
import { type Connection, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { References } from "../../DefinitionReferences"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { VGUITextDocument, type VGUITextDocumentDependencies } from "./VGUITextDocument"
import { VGUIWorkspace } from "./VGUIWorkspace"

export class VGUILanguageServer extends VDFLanguageServer<"vdf", VGUITextDocument, VGUITextDocumentDependencies> {

	private readonly workspaces: Map<string, VGUIWorkspace>

	constructor(languageId: "vdf", name: "VDF", connection: Connection) {
		super(languageId, name, connection, {
			name: "vdf",
			servers: new Set(["hudanimations"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$, refCountDispose) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem$ = this.fileSystems.get((teamFortress2Folder) => [
					hudRoot ? { type: "folder", uri: hudRoot } : { type: "folder", uri: init.uri.dirname() },
					{ type: "tf2", uri: teamFortress2Folder }
				])

				let workspace: VGUIWorkspace | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = new VGUIWorkspace({
							uri: hudRoot,
							fileSystem$: fileSystem$,
							documents: this.documents,
							request: this.trpc.servers.hudanimations.workspace.open.mutate({ uri: hudRoot })
						})
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
					fileSystem$,
					this.documents,
					workspace,
					refCountDispose,
				)
			}
		})

		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				workspace: t.router({
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
									new VGUIWorkspace({
										uri: input.uri,
										fileSystem$: this.fileSystems.get((teamFortress2Folder) => [
											{ type: "folder", uri: input.uri },
											{ type: "tf2", uri: teamFortress2Folder }
										]),
										documents: this.documents,
										request: Promise.resolve()
									})
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
						.query(async ({ input }) => {
							const workspace = this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							return workspace.getVDFDocumentSymbols(input.path)
						}),
					definitions: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								path: z.string(),
							})
						)
						.query(({ input }) => {
							const workspace = this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							return workspace.getDefinitionReferences(input.path).pipe(
								map((definitionReferences) => definitionReferences?.definitions ?? null)
							)
						}),
					setClientSchemeReferences: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								references: z.instanceof(References).array()
							})
						)
						.mutation(async ({ input }) => {
							const workspace = this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							workspace.setClientSchemeReferences(input.references)
						}),
					setFilesReferences: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
								references: z.map(z.string(), z.instanceof(References).array())
							})
						)
						.mutation(async ({ input }) => {
							const workspace = this.workspaces.get(input.key.toString())
							if (!workspace) {
								throw new Error(`VGUIWorkspace "${input.key.toString()}" does not exist.`)
							}

							for (const [path, documentReferences] of input.references) {
								workspace.setFileReferences(path, documentReferences)
							}
						})
				})
			})
		)
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<VGUITextDocument>): Promise<{ onDidClose: () => void }> {
		return await super.onDidOpen(event)
	}
}
