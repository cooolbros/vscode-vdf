import { type DataTransformer, type TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { FileSystemKey } from "common/FileSystemKey"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { usingAsync } from "common/operators/usingAsync"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { posix } from "path"
import { map, switchMap } from "rxjs"
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

	private readonly workspaces: RefCountAsyncDisposableFactory<Uri, VMTWorkspace>

	constructor(languageId: "vmt", name: "VMT", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			platform: platform,
			servers: new Set(["vdf"]),
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

				if (init.uri.scheme == "bsp") {
					paths.push({ type: "bsp", bsp: new Uri(JSON.parse(new URLSearchParams(init.uri.query).get("root")!)) })
				}

				paths.push({ type: "tf2", teamFortress2Folder: teamFortress2Folder })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", folder: workspaceUri })))

				const workspace = workspaceRoot != null
					? this.workspaces.get(workspaceRoot)
					: null

				return new VMTTextDocument(
					init,
					documentConfiguration$,
					await this.fileSystems.get(paths),
					(uri) => fromTRPCSubscription(this.trpc.client.workspace.createFileSystemWatcher, { uri }),
					this.documents,
					await workspace,
				)
			}
		})

		this.workspaces = new RefCountAsyncDisposableFactory(
			(uri) => uri.toString(),
			async (uri) => new VMTWorkspace({
				uri: uri,
				fileSystem: await this.fileSystems.get([
					{ type: "folder", folder: uri },
					{ type: "tf2", teamFortress2Folder: (await this.workspaceUris.promise).teamFortress2Folder }
				]),
				server: this,
			})
		)
	}

	protected router(t: TRPCRootObject<{ client: VSCodeVDFLanguageID }, object, { transformer: DataTransformer }>) {
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
						return observableToAsyncIterable<{ path: string } | null>(
							usingAsync(async () => await this.documents.get(input.uri)).pipe(
								switchMap((document) => {
									return document.documentSymbols$.pipe(
										map((documentSymbols) => {
											const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children
											if (!header) {
												return null
											}

											let baseTexture = header.find((documentSymbol) => documentSymbol.key.toLowerCase() == "$baseTexture".toLowerCase())?.detail
											if (!baseTexture) {
												return null
											}

											baseTexture = baseTexture.replaceAll(/[/\\]+/g, "/")
											if (posix.extname(baseTexture) != ".vtf") {
												baseTexture += ".vtf"
											}

											return { path: posix.resolve(`/materials/${baseTexture}`).substring(1) }
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
