import { type DataTransformer, type TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import type { FileSystemKey } from "common/FileSystemKey"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { usingAsync } from "common/operators/usingAsync"
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

	private readonly workspaces: Map<string, Promise<VMTWorkspace>>

	constructor(languageId: "vmt", name: "VMT", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			name: "vmt",
			platform: platform,
			servers: new Set(),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const paths: FileSystemKey[] = []

				const [workspaceUris, workspaceRoot] = await Promise.all([
					this.workspaceUris.promise,
					this.trpc.client.searchForWorkspaceRoot.query({ uri: init.uri })
				])

				if (workspaceRoot != null) {
					paths.push({ type: "folder", uri: workspaceRoot })
				}

				if (init.uri.scheme == "bsp") {
					paths.push({ type: "bsp", uri: new Uri(JSON.parse(new URLSearchParams(init.uri.query).get("root")!)) })
				}

				paths.push({ type: "tf2" })
				paths.push(...workspaceUris.map((workspaceUri) => ({ type: <const>"folder", uri: workspaceUri })))

				const workspace = this.workspaces.getOrInsertComputed(workspaceRoot?.toString() ?? "tf2", async () => {
					return new VMTWorkspace(workspaceRoot ?? new Uri({ scheme: "file", path: "/" }), await this.fileSystems.get(paths), this.documents)
				})

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
		this.workspaces = new Map()
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
