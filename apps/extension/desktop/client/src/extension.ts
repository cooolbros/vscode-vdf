import { VPKFileSystemProvider } from "lib/VPK/VPKFileSystemProvider"
import { VPKManager } from "lib/VPK/VPKManager"
import { initHUDAnimationsLanguageClientDecorations } from "lib/client/HUDAnimationsDecoration"
import { initLanguageClientFileSystem } from "lib/client/LanguageClientFileSystem"
import { initLanguageClientRequests } from "lib/client/LanguageClientRequests"
import { VSCodeLanguageClientFileSystem } from "lib/client/VSCodeLanguageClientFileSystem"
import { JSONToVDF } from "lib/commands/JSONToVDF"
import { VDFToJSON } from "lib/commands/VDFToJSON"
import { copyKeyValuePath } from "lib/commands/copyKeyValuePath"
import { extractVPKFileToWorkspace } from "lib/commands/extractVPKFileToWorkspace"
import { showReferences } from "lib/commands/showReferences"
import { VSCodeVDFLanguageIDSchema } from "lib/types/VSCodeVDFLanguageID"
import { languageClientsInfo } from "lib/types/languageClientsInfo"
import { join } from "path"
import { commands, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"
import { VTFEditor } from "./VTF/VTFEditor"

const languageClients: { -readonly [P in keyof typeof languageClientsInfo]?: LanguageClient } = {}

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
	const vpks = new VPKManager(new VSCodeLanguageClientFileSystem())
	context.subscriptions.push(workspace.registerFileSystemProvider("vpk", new VPKFileSystemProvider(vpks), { isCaseSensitive: false, isReadonly: true }))

	// Language Server

	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {

		const languageId: string = e.languageId
		if (((languageId): languageId is keyof typeof languageClientsInfo => languageId in languageClientsInfo)(languageId)) {
			startServer(languageId)
		}
	}

	const startServer = async (languageId: keyof typeof languageClientsInfo): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = context.asAbsolutePath(join("apps/extension/desktop/servers/dist", `${languageId}.js`))

		const serverOptions: ServerOptions = {
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
		}

		const clientOptions: LanguageClientOptions = {
			documentSelector: [
				languageId
			]
		}

		const languageClient = languageClients[languageId] = new LanguageClient(
			`${languageClientsInfo[languageId].id}-language-server`,
			`${languageClientsInfo[languageId].name} Language Server`,
			serverOptions,
			clientOptions
		)

		initLanguageClientFileSystem(languageClient)
		context.subscriptions.push(initLanguageClientRequests(languageClients, languageClient))

		// Decorations
		if (languageId == "hudanimations") {
			context.subscriptions.push(initHUDAnimationsLanguageClientDecorations(languageClient))
		}

		await languageClient.start()
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

export async function deactivate(): Promise<void[]> {
	const promises: Promise<void>[] = []
	let languageId: keyof typeof languageClients
	for (languageId in languageClients) {
		if (languageClients[languageId] != null) {
			promises.push(languageClients[languageId]!.stop())
		}
	}
	return Promise.all(promises)
}
