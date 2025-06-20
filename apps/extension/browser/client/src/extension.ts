import { Client, VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "client"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { executeCommands } from "client/commands/executeCommands"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { selectTeamFortress2Folder } from "client/commands/selectTeamFortress2Folder"
import { setVTFFlags } from "client/commands/setVTFFlags"
import { showReferences } from "client/commands/showReferences"
import { showWaveStatusPreviewToSide } from "client/commands/showWaveStatusPreviewToSide"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { onDidChangeActiveTextEditor } from "client/decorations"
import { FileSystemWatcherFactory } from "client/FileSystemWatcherFactory"
import { createMiddleware } from "client/middleware"
import { RemoteResourceFileSystemProvider } from "client/RemoteResourceFileSystemProvider"
import { FolderFileSystem } from "client/VirtualFileSystem/FolderFileSystem"
import { VSCodeFileSystem } from "client/VirtualFileSystem/VSCodeFileSystem"
import { VTFEditor } from "client/VTF/VTFEditor"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { of } from "rxjs"
import { commands, FileType, languages, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser"

const languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<LanguageClient> } = {}

export function activate(context: ExtensionContext): void {

	const teamFortress2Folder$ = of(new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" }))

	const fileSystemMountPointFactory = new RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>(
		(paths) => JSON.stringify(paths),
		async (path, factory) => {
			switch (path.type) {
				case "folder": {
					return await FolderFileSystem(path.uri)
				}
				case "tf2": {
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
			}
		}
	)

	const fileSystemWatcherFactory = new FileSystemWatcherFactory()

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands
	context.subscriptions.push(commands.registerCommand("vscode-vdf.executeCommands", executeCommands))
	context.subscriptions.push(commands.registerCommand("vscode-vdf.selectTeamFortress2Folder", selectTeamFortress2Folder))
	context.subscriptions.push(commands.registerCommand("vscode-vdf.setVTFFlags", setVTFFlags))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates(fileSystemMountPointFactory)))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showWaveStatusPreviewToSide", showWaveStatusPreviewToSide(context, fileSystemMountPointFactory)))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	context.subscriptions.push(window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor))
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context.extensionUri, fileSystemWatcherFactory, context.subscriptions)))

	// Language Server
	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const result = VSCodeVDFLanguageIDSchema.safeParse(e.languageId)
		if (result.success) {
			startServer(result.data)
		}
	}

	const middleware = createMiddleware(context)

	const startServer = async (languageId: VSCodeVDFLanguageID): Promise<void> => {

		if (languageClients[languageId]) {
			return
		}

		const serverModule = new Uri(context.extensionUri).joinPath("apps/extension/browser/servers/dist", `${languageId}.js`).toString(true)
		const name = VSCodeVDFLanguageNameSchema.shape[languageId].value

		const languageStatusItem = languages.createLanguageStatusItem(`vscode-vdf.${name.replaceAll(" ", "")}LanguageStatusItem`, languageId)
		context.subscriptions.push(languageStatusItem)

		languageStatusItem.text = "$(cloud)"
		languageStatusItem.command = {
			title: RemoteResourceFileSystemProvider.base,
			command: "vscode.open",
			arguments: [RemoteResourceFileSystemProvider.base]
		}

		const client = languageClients[languageId] = new Client(
			context,
			languageClients,
			startServer,
			teamFortress2Folder$,
			fileSystemMountPointFactory,
			fileSystemWatcherFactory,
			new LanguageClient(
				`${languageId}-language-server`,
				`${name} Language Server`,
				{
					documentSelector: [
						languageId
					],
					middleware: middleware[languageId],
				} satisfies LanguageClientOptions,
				new Worker(serverModule)
			)
		)

		context.subscriptions.push(client)
		await client.start()
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	context.subscriptions.push(workspace.onDidOpenTextDocument(onDidOpenTextDocument))
}
