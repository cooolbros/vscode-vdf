import type { TRPCCombinedDataTransformer, initTRPC } from "@trpc/server"
import { Uri } from "common/Uri"
import { firstValueFrom } from "rxjs"
import { type Connection } from "vscode-languageserver"
import { z } from "zod"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { resolveFileDetail } from "../VDFTextDocument"
import { VMTTextDocument } from "./VMTTextDocument"
import { VMTWorkspace } from "./VMTWorkspace"

export class VMTLanguageServer extends VDFLanguageServer<"vmt", VMTTextDocument> {

	private readonly workspaces: Map<string, VMTWorkspace>

	constructor(languageId: "vmt", name: "VMT", connection: Connection) {
		super(languageId, name, connection, {
			name: "vmt",
			servers: new Set(),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem = await this.fileSystems.get([
					...(hudRoot ? [{ type: <const>"folder", uri: hudRoot }] : []),
					{ type: "tf2" }
				])

				let workspace: WorkspaceBase | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = new VMTWorkspace(hudRoot)
						this.workspaces.set(key, w)
					}
					workspace = w
				}
				else {
					workspace = null
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
					.query(async ({ input }) => {

						await using document = await this.documents.get(input.uri)
						const documentSymbols = await firstValueFrom(document.documentSymbols$)

						const header = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")
						if (!header || !header.children) {
							return null
						}

						const baseTexture = header.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "$baseTexture".toLowerCase() && documentSymbol.detail != undefined)
						if (!baseTexture) {
							return null
						}

						const schema = (await firstValueFrom(document.configuration.dependencies$)).schema
						const path = resolveFileDetail(baseTexture.detail!, schema.files.find(({ keys }) => keys.has("$baseTexture".toLowerCase()))!)

						return await firstValueFrom(document.fileSystem.resolveFile(path))
					})
			})
		)
	}
}
