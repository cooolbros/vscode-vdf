import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { FileSystemKey } from "common/FileSystemKey"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { usingAsync } from "common/operators/usingAsync"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { firstValueFrom, map, switchMap } from "rxjs"
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
		const reject = (uri: Uri) => Promise.reject(`VGUIWorkspace "${uri.toString()}" does not exist.`)
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
					clientScheme: t
						.procedure
						.input(
							z.object({
								key: Uri.schema,
							})
						)
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
									switchMap((workspace) => {
										return workspace.clientScheme$.pipe(
											map((definitionReferences) => definitionReferences.definitions)
										)
									})
								),
								signal!
							)
						}),
					languageTokens: t
						.procedure
						.input(z.object({ key: Uri.schema }))
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
									switchMap((workspace) => {
										return workspace.languageTokens$.pipe(
											map((definitionReferences) => definitionReferences.definitions)
										)
									})
								),
								signal!
							)
						}),
					hudanimations_manifest: t
						.procedure
						.input(z.object({ key: Uri.schema }))
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<string[]>(
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
									switchMap((workspace) => workspace.hudanimations_manifest$)
								),
								signal!
							)
						}),
					itemsGame: {
						open: t
							.procedure
							.input(z.object({ key: Uri.schema }))
							.subscription(({ input, signal }) => {
								return observableToAsyncIterable<void>(
									usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
										switchMap((workspace) => workspace.itemsGame$),
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
									name: z.string(),
								})
							)
							.query(async ({ input }) => {
								return await firstValueFrom(
									usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
										switchMap((workspace) => workspace.itemsGame$),
										switchMap((document) => document.documentSymbols$),
										map((documentSymbols) => {
											const name = input.name.toLowerCase()

											const items_game = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "items_game")?.children
											if (!items_game) {
												throw new Error("items_game")
											}

											const section = items_game.find((documentSymbol) => documentSymbol.key.toLowerCase() == name)?.children
											if (!section) {
												throw new Error(input.name)
											}

											return section
										})
									)
								)
							}),
						definitions: t
							.procedure
							.input(
								z.object({
									key: Uri.schema,
								})
							)
							.query(async ({ input }) => {
								await using workspace = await this.workspaces.get(input.key, reject)
								await using document = await firstValueFrom(workspace.itemsGame$)
								const definitionReferences = await firstValueFrom(document.definitionReferences$)

								return definitionReferences.definitions
							}),
					},
					gameSounds: t
						.procedure
						.input(z.object({ key: Uri.schema }))
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
									switchMap((workspace) => {
										return workspace.gameSounds$.pipe(
											map((definitionReferences) => definitionReferences.definitions)
										)
									})
								),
								signal!
							)
						}),
					surfaceProperties: t
						.procedure
						.input(z.object({ key: Uri.schema }))
						.subscription(async ({ input, signal }) => {
							return observableToAsyncIterable<Definitions>(
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
									switchMap((workspace) => {
										return workspace.surfaceProperties$.pipe(
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
								usingAsync(async () => await this.workspaces.get(input.key, reject)).pipe(
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
							await using workspace = await this.workspaces.get(input.key, reject)

							for (const [path, documentReferences] of input.references) {
								workspace.setFileReferences(path, documentReferences)
							}
						})
				}
			})
		)
	}
}
