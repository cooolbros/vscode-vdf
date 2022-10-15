import { copyKeyValuePath } from "$lib/commands/copyKeyValuePath"
import { extractVPKFileToWorkspace } from "$lib/commands/extractVPKFileToWorkspace"
import { formatVDF } from "$lib/commands/formatVDF"
import { importPopfileTemplates } from "$lib/commands/importPopfileTemplates"
import { JSONToVDF } from "$lib/commands/JSONToVDF"
import { showReferences } from "$lib/commands/showReferences"
import { sortVDF } from "$lib/commands/sortVDF"
import { VDFToJSON } from "$lib/commands/VDFToJSON"
import { languageClientsInfo } from "$lib/languageClientsInfo"
import { join } from "path"
import { commands, ExtensionContext, TextDocument, window, workspace } from "vscode"
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node"
import { VPKTextDocumentContentProvider } from "./VPKTextDocumentContentProvider"
import { VTFEditor } from "./VTF/VTFEditor"

const languageClients: { -readonly [P in keyof typeof languageClientsInfo]?: LanguageClient } = {}

export function activate(context: ExtensionContext): void {

	// https://code.visualstudio.com/api/references/contribution-points#contributes

	// Commands

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.extractVPKFileToWorkspace", extractVPKFileToWorkspace))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.formatVDF", formatVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.sortVDF", sortVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// VPK Protocol

	context.subscriptions.push(workspace.registerTextDocumentContentProvider("vpk", new VPKTextDocumentContentProvider(workspace)))

	// Language Server

	const onDidOpenTextDocument = (e: TextDocument): void => {
		const languageId: string = e.languageId
		if (((languageId): languageId is keyof typeof languageClientsInfo => languageId in languageClientsInfo)(languageId)) {
			if (!languageClients[languageId]) {

				const serverModule = context.asAbsolutePath(join("dist/desktop/servers", `${languageId}.js`,))

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

				languageClients[languageId] = new LanguageClient(
					languageClientsInfo[languageId].id,
					languageClientsInfo[languageId].name,
					serverOptions,
					clientOptions
				)

				languageClients[languageId]!.start()
			}
		}
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)

	// Custom Editors

	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context)))
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
