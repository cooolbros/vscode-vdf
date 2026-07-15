import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { FileSystemKey } from "common/FileSystemKey"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { usingAsync } from "common/operators/usingAsync"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { map, switchMap } from "rxjs"
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

	private readonly workspaces: RefCountAsyncDisposableFactory<Uri, VGUIWorkspace>

	constructor(languageId: "vdf", name: "VDF", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vdf",
			platform: platform,
			servers: new Set(["hudanimations"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const paths: FileSystemKey[] = []

				const [{ teamFortress2Folder, workspaceUris }, workspaceRoot] = await Promise.all([
					this.workspaceUris.promise,
					this.trpc.client.searchForWorkspaceRoot.query({ uri: init.uri })
				])

				if (workspaceRoot != null) {
					paths.push({ type: "folder", folder: workspaceRoot })
				}

				paths.push({ type: "tf2", teamFortress2Folder: teamFortress2Folder })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", folder: workspaceUri })))

				const workspace = workspaceRoot != null
					? this.workspaces.get(workspaceRoot)
					: null

				return new VGUITextDocument(
					init,
					documentConfiguration$,
					teamFortress2Folder,
					await this.fileSystems.get(paths),
					(uri) => fromTRPCSubscription(this.trpc.client.workspace.createFileSystemWatcher, { uri }),
					this.documents,
					await workspace,
				)
			}
		})

		this.workspaces = new RefCountAsyncDisposableFactory(
			(uri) => uri.toString(),
			async (uri) => new VGUIWorkspace({
				uri: uri,
				fileSystem: await this.fileSystems.get([
					{ type: "folder", folder: uri },
					{ type: "tf2", teamFortress2Folder: (await this.workspaceUris.promise).teamFortress2Folder }
				]),
				documents: this.documents,
			})
		)
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
						.subscription(({ input, signal }) => {
							return observableToAsyncIterable<void>(
								usingAsync(async () => await this.workspaces.get(input.uri)).pipe(
									map(() => undefined),
								),
								signal!
							)
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
							return observableToAsyncIterable<VDFDocumentSymbols | null>(
								usingAsync(async () => await this.workspaces.get(input.key)).pipe(
									switchMap((workspace) => {
										return workspace.getVDFDocumentSymbols(input.path)
									})
								),
								signal!
							)
						}),
					clientScheme: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
							})
						)
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key)).pipe(
									switchMap((workspace) => {
										return workspace.clientScheme$.pipe(
											map((definitionReferences) => definitionReferences.definitions)
										)
									})
								),
								signal!
							)
						}),
					gameSounds: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
							})
						)
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key)).pipe(
									switchMap((workspace) => {
										return workspace.gameSounds$.pipe(
											map((definitionReferences) => definitionReferences.definitions)
										)
									})
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
							return observableToAsyncIterable<{ uri: Uri, definitions: Definitions } | null>(
								usingAsync(async () => await this.workspaces.get(input.key)).pipe(
									switchMap((workspace) => {
										return workspace.getDefinitionReferences(input.path)
									})
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
							await using workspace = await this.workspaces.get(input.key, async () => Promise.reject(`VGUIWorkspace "${input.key.toString()}" does not exist.`))

							for (const [path, documentReferences] of input.references) {
								workspace.setFileReferences(path, documentReferences)
							}
						})
				}
			})
		)
	}
}
