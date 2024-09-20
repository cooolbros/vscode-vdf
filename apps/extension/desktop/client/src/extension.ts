import { Client } from "client"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { extractVPKFileToWorkspace } from "client/commands/extractVPKFileToWorkspace"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { showReferences } from "client/commands/showReferences"
import { languageNames } from "client/languageNames"
import { join } from "path"
import type { LanguageNames } from "utils/types/LanguageNames"
import { commands, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"
import { VPKFileSystemProvider } from "./VPK/VPKFileSystemProvider"
import { VTFEditor } from "./VTF/VTFEditor"

const languageClients: { -readonly [P in keyof LanguageNames]?: Client } = {}

export function activate(context: ExtensionContext): void {

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.extractVPKFileToWorkspace", extractVPKFileToWorkspace))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context)))

	// Workspace
	context.subscriptions.push(workspace.registerFileSystemProvider("vpk", new VPKFileSystemProvider(), { isCaseSensitive: false, isReadonly: true }))

	// Language Server

	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const languageId = e.languageId
		if (((languageId): languageId is keyof LanguageNames => languageId in languageNames)(languageId)) {
			startServer(languageId)
		}
	}

	const startServer = async (languageId: keyof LanguageNames): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = context.asAbsolutePath(join("apps/extension/desktop/servers/dist", `${languageId}.js`))

		const client = languageClients[languageId] = new Client(
			languageClients,
			startServer,
			new LanguageClient(
				`${languageId}-language-server`,
				`${languageNames[languageId]} Language Server`,
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
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}
