import { Client } from "client"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { showReferences } from "client/commands/showReferences"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { languageNames } from "utils/languageNames"
import { commands, Uri, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser"

const languageClients: { -readonly [P in keyof typeof languageNames]?: Client } = {}

export function activate(context: ExtensionContext): void {

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Language Server

	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const languageId = e.languageId
		if (((languageId): languageId is keyof typeof languageNames => languageId in languageNames)(languageId)) {
			startServer(languageId)
		}
	}

	const startServer = async (languageId: keyof typeof languageNames): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = Uri.joinPath(context.extensionUri, "apps/extension/browser/servers/dist", `${languageId}.js`).toString(true)

		const client = languageClients[languageId] = new Client(
			languageClients,
			startServer,
			new LanguageClient(
				`${languageId}-language-server`,
				`${languageNames[languageId]} Language Server`,
				{
					documentSelector: [
						languageId
					]
				} satisfies LanguageClientOptions,
				new Worker(serverModule)
			)
		)

		context.subscriptions.push(client)
		await client.start()
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}
