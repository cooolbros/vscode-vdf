import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { FileSystemKey } from "common/FileSystemKey"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { Uri } from "common/Uri"
import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { map } from "rxjs"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { type Connection, type InitializeParams } from "vscode-languageserver"
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

	private readonly teamFortress2Folder: PromiseWithResolvers<Uri>
	private readonly workspaces: Map<string, Promise<VGUIWorkspace>>

	constructor(languageId: "vdf", name: "VDF", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vdf",
			platform: platform,
			servers: new Set(["hudanimations"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const paths: FileSystemKey[] = []

				const [workspaceUris, workspaceRoot] = await Promise.all([
					this.workspaceUris,
					this.trpc.client.searchForWorkspaceRoot.query({ uri: init.uri })
				])

				if (workspaceRoot != null) {
					paths.push({ type: "folder", uri: workspaceRoot })
				}

				paths.push({ type: "tf2" })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", uri: workspaceUri })))

				let workspace: Promise<VGUIWorkspace> | null
				if (workspaceRoot != null) {
					workspace = this.workspaces.getOrInsertComputed(workspaceRoot.toString(), async () => new VGUIWorkspace({
						uri: workspaceRoot,
						fileSystem: await this.fileSystems.get(paths),
						documents: this.documents,
						request: this.trpc.servers.hudanimations.workspace.open.mutate({ uri: workspaceRoot })
					}))
				}
				else {
					workspace = null
				}

				return new VGUITextDocument(
					init,
					documentConfiguration$,
					this.teamFortress2Folder.promise,
					await this.fileSystems.get(paths),
					(uri) => fromTRPCSubscription(this.trpc.client.workspace.createFileSystemWatcher, { uri }),
					this.documents,
					await workspace,
				)
			}
		})

		this.teamFortress2Folder = Promise.withResolvers<Uri>()
		this.workspaces = new Map()
	}

	protected router(t: TRPCRootObject<{ client: VSCodeVDFLanguageID }, object, { transformer: DataTransformer }>) {
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
							this.workspaces.getOrInsertComputed(input.uri.toString(), async () => {
								return new VGUIWorkspace({
									uri: input.uri,
									fileSystem: await this.fileSystems.get([
										{ type: "folder", uri: input.uri },
										{ type: "tf2" }
									]),
									documents: this.documents,
									request: Promise.resolve()
								})
							})
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

	protected async onInitialize(params: InitializeParams) {
		const { teamFortress2Folder } = z.object({ teamFortress2Folder: Uri.schema }).parse(params.initializationOptions)
		this.teamFortress2Folder.resolve(teamFortress2Folder)

		return {
			...await super.onInitialize(params),
			teamFortress2Folder
		}
	}
}
