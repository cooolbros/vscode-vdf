import { copyKeyValuePath } from "$lib/commands/copyKeyValuePath";
import { extractVPKFileToWorkspace } from "$lib/commands/extractVPKFileToWorkspace";
import { formatVDF } from "$lib/commands/formatVDF";
import { importPopfileTemplates } from "$lib/commands/importPopfileTemplates";
import { JSONToVDF } from "$lib/commands/JSONToVDF";
import { showReferences } from "$lib/commands/showReferences";
import { sortVDF } from "$lib/commands/sortVDF";
import { VDFToJSON } from "$lib/commands/VDFToJSON";
import * as path from "path";
import { commands, ExtensionContext, TextDocument, window, workspace } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";
import { VPKTextDocumentContentProvider } from "./VPKTextDocumentContentProvider";
import { VTFEditor } from "./VTF/VTFEditor";

const clientsInfo = {
	hudanimations: {
		id: "hudanimations-language-server",
		name: "HUD Animations Language Server",
	},
	vdf: {
		id: "vdf-language-server",
		name: "VDF Language Server",
	},
	popfile: {
		id: "popfile-language-server",
		name: "Popfile Language Server"
	}
}

const clients: Record<keyof typeof clientsInfo, LanguageClient | null> = {
	hudanimations: null,
	vdf: null,
	popfile: null
}

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

	const onDidOpenTextDocument = (e: TextDocument) => {
		const languageId: string = e.languageId
		if (((languageId): languageId is keyof typeof clientsInfo => clientsInfo.hasOwnProperty(languageId))(languageId)) {
			if (clients[languageId] == null) {

				const serverModule = context.asAbsolutePath(path.join("servers", languageId, "dist", "server.js"))

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

				clients[languageId] = new LanguageClient(
					clientsInfo[languageId].id,
					clientsInfo[languageId].name,
					serverOptions,
					clientOptions
				)

				clients[languageId]!.start()
			}
		}
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	workspace.onDidOpenTextDocument(onDidOpenTextDocument)

	// Custom Editors

	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context)))
}

export function deactivate() {
	const promises: Promise<void>[] = []
	let languageId: keyof typeof clients
	for (languageId in clients) {
		if (clients[languageId] != null) {
			promises.push(clients[languageId]!.stop())
		}
	}
	return Promise.all(promises)
}
