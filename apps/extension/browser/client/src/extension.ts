import { Client, VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "client"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { selectTeamFortress2Folder } from "client/commands/selectTeamFortress2Folder"
import { showReferences } from "client/commands/showReferences"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { onDidChangeActiveTextEditor } from "client/decorations"
import { RemoteResourceFileSystemProvider } from "client/RemoteResourceFileSystemProvider"
import type { FileSystemMountPointFactory } from "client/VirtualFileSystem/FileSystemMountPointFactory"
import { VSCodeFileSystem } from "client/VirtualFileSystem/VSCodeFileSystem"
import { VTFEditor } from "client/VTF/VTFEditor"
import { Uri } from "common/Uri"
import { of } from "rxjs"
import { commands, FileType, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser"

const languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<LanguageClient> } = {}

export function activate(context: ExtensionContext): void {

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands
	context.subscriptions.push(commands.registerCommand("vscode-vdf.selectTeamFortress2Folder", selectTeamFortress2Folder))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	context.subscriptions.push(window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor))
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context.extensionUri, context.subscriptions)))

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

		const serverModule = new Uri(context.extensionUri).joinPath("apps/extension/browser/servers/dist", `${languageId}.js`).toString(true)
		const name = VSCodeVDFLanguageNameSchema.shape[languageId].value

		const client = languageClients[languageId] = new Client(
			context,
			languageClients,
			startServer,
			of(new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" })),
			{
				[RemoteResourceFileSystemProvider.scheme]: async (teamFortress2Folder: Uri, factory: FileSystemMountPointFactory) => {
					const root = new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" })

					try {
						console.log(await workspace.fs.stat(root))
					}
					catch (error) {
						console.warn(error)
						context.subscriptions.push(workspace.registerFileSystemProvider(RemoteResourceFileSystemProvider.scheme, new RemoteResourceFileSystemProvider(), { isCaseSensitive: true, isReadonly: true }))
					}

					return await VSCodeFileSystem(
						root,
						FileType.Directory,
						false,
						(path) => root.joinPath(path)
					)
				}
			},
			new LanguageClient(
				`${languageId}-language-server`,
				`${name} Language Server`,
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
