import { Client } from "client"
import { VSCodeLanguageClientFileSystem } from "client/VSCodeLanguageClientFileSystem"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { extractVPKFileToWorkspace } from "client/commands/extractVPKFileToWorkspace"
import { showReferences } from "client/commands/showReferences"
import { languageClientsInfo } from "lib/types/languageClientsInfo"
import { join } from "path"
import { commands, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"
import { VPKFileSystemProvider } from "./VPK/VPKFileSystemProvider"
import { VTFEditor } from "./VTF/VTFEditor"

const languageClients: { -readonly [P in keyof typeof languageClientsInfo]?: Client } = {}

export function activate(context: ExtensionContext): void {

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.extractVPKFileToWorkspace", extractVPKFileToWorkspace))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context)))

	// Workspace
	context.subscriptions.push(workspace.registerFileSystemProvider("vpk", new VPKFileSystemProvider(new VSCodeLanguageClientFileSystem()), { isCaseSensitive: false, isReadonly: true }))

	// Language Server

	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const languageId = e.languageId
		if (((languageId): languageId is keyof typeof languageClientsInfo => languageId in languageClientsInfo)(languageId)) {
			startServer(languageId)
		}
	}

	const startServer = async (languageId: keyof typeof languageClientsInfo): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = context.asAbsolutePath(join("apps/extension/desktop/servers/dist", `${languageId}.js`))

		const client = languageClients[languageId] = new Client(
			languageId,
			new LanguageClient(
				`${languageClientsInfo[languageId].id}-language-server`,
				`${languageClientsInfo[languageId].name} Language Server`,
				{
					run: {
						module: serverModule,
						transport: TransportKind.ipc
					},
					debug: {
						module: serverModule,
						transport: TransportKind.ipc,
						options: {
							execArgv: [
								"--nolazy",
								"--inspect=6009"
							]
						}
					}
				} satisfies ServerOptions,
				{
					documentSelector: [
						languageId
					]
				} satisfies LanguageClientOptions
			)
		)

		context.subscriptions.push(client)
		await client.start()

		const servers = VSCodeVDFLanguageIDSchema.array().optional().parse(languageClient.initializeResult?.["servers"])
		if (servers) {
			for (const languageId of servers) {
				try {
					startServer(languageId)
				}
				catch (error: any) {
					window.showErrorMessage(error.message)
				}
			}
		}
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}
