import * as path from "path";
import { commands, ExtensionContext, TextDocument, workspace } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";
import { extractVPKFileToWorkspace } from "./commands/extractVPKFileToWorkspace";
import { formatVDF } from "./commands/formatVDF";
import { importPopfileTemplates } from "./commands/importPopfileTemplates";
import { JSONToVDF } from "./commands/JSONToVDF";
import { showReferences } from "./commands/showReferences";
import { sortVDF } from "./commands/sortVDF";
import { VDFToJSON } from "./commands/VDFToJSON";
import { VPKTextDocumentContentProvider } from "./VPKTextDocumentContentProvider";

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

	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.extractVPKFileToWorkspace", extractVPKFileToWorkspace))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.formatVDF", formatVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.sortVDF", sortVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// VPK Protocol
	workspace.registerTextDocumentContentProvider("vpk", new VPKTextDocumentContentProvider(workspace))

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
