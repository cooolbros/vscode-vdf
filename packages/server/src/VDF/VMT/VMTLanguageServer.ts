import { CompletionItemKind, InsertTextFormat, type Connection } from "vscode-languageserver"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFLanguageServer } from "../VDFLanguageServer"
import { VMTTextDocument, type VMTTextDocumentDependencies } from "./VMTTextDocument"
import { VMTWorkspace } from "./VMTWorkspace"

export class VMTLanguageServer extends VDFLanguageServer<"vmt", VMTTextDocument, VMTTextDocumentDependencies> {

	private readonly workspaces: Map<string, VMTWorkspace>

	constructor(languageId: "vmt", name: "VMT", connection: Connection) {
		super(languageId, name, connection, {
			name: "vmt",
			servers: new Set(),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem$ = this.fileSystems.get((teamFortress2Folder) => [
					hudRoot ? { type: "folder", uri: hudRoot } : null,
					{ type: "tf2", uri: teamFortress2Folder }
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
					fileSystem$,
					this.documents,
					workspace
				)
			},
			completion: {
				root: [
					{
						label: "LightmappedGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "WaveSchedule\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					},
					{
						label: "UnlitGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "WaveSchedule\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					},
					{
						label: "VertexlitGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "WaveSchedule\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					}
				],
				typeKey: null,
				defaultType: null
			}
		})
		this.workspaces = new Map()
	}
}
