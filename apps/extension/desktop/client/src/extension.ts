import { Client, VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "client"
import { VTFEditor } from "client/VTF/VTFEditor"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { extractVPKFileToWorkspace } from "client/commands/extractVPKFileToWorkspace"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { showReferences } from "client/commands/showReferences"
import { onDidChangeActiveTextEditor } from "client/decorations"
import { join } from "path"
import { commands, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"
import { VPKFileSystemProvider } from "./VPK/VPKFileSystemProvider"

const languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<LanguageClient> } = {}

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
	context.subscriptions.push(window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor))
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context.extensionUri, context.subscriptions)))

	// Workspace
	context.subscriptions.push(workspace.registerFileSystemProvider("vpk", new VPKFileSystemProvider(), { isCaseSensitive: false, isReadonly: true }))

	// Language Server

	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const result = VSCodeVDFLanguageIDSchema.safeParse(e.languageId)
		if (result.success) {
			startServer(result.data)
		}
	}

	const startServer = async (languageId: VSCodeVDFLanguageID): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = context.asAbsolutePath(join("apps/extension/desktop/servers/dist", `${languageId}.js`))
		const name = VSCodeVDFLanguageNameSchema.shape[languageId].value

		const client = languageClients[languageId] = new Client<LanguageClient>(
			languageClients,
			startServer,
			context.subscriptions,
			new LanguageClient(
				`${languageId}-language-server`,
				`${name} Language Server`,
				{
					run: {
						module: serverModule,
						transport: TransportKind.ipc,
						...(process.env.NODE_ENV != "production" && {
							options: {
								execArgv: [
									"--nolazy",
									`--inspect=${6000 + Object.keys(VSCodeVDFLanguageNameSchema.shape).indexOf(languageId)}`
								]
							}
						})
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
					],
					...(process.env.NODE_ENV != "production" && {
						connectionOptions: {
							maxRestartCount: 1
						}
					})
				} satisfies LanguageClientOptions
			)
		)

		context.subscriptions.push(
			client,
			commands.registerCommand(`vscode-vdf.restart${name.replaceAll(" ", "")}LanguageServer`, () => {
				client.client.restart()
			})
		)
		await client.start()
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)
}
