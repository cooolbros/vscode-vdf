import { Client, VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "client"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { executeCommands } from "client/commands/executeCommands"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { listPopfileClassIcons } from "client/commands/listPopfileClassIcons"
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
import type { FileSystemKey } from "common/FileSystemKey"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { firstValueFrom, of } from "rxjs"
import { commands, Disposable, FileType, languages, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser"

const languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<LanguageClient> } = {}

export function activate(context: ExtensionContext): void {

	const subscriptions = context.subscriptions

	const teamFortress2Folder$ = of(new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" }))

	const fileSystemMountPointFactory = new RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>(
		(paths) => JSON.stringify(paths),
		async (path, factory) => {
			switch (path.type) {
				case "folder": {
					return await FolderFileSystem(path.folder)
				}
				case "tf2": {
					const root = new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" })
					return await VSCodeFileSystem({
						root: root,
						type: FileType.Directory,
						watch: false,
						resolvePath: (path) => root.joinPath(path)
					})
				}
				case "popfile:bsp":
					throw new Error("popfile:bsp")
				case "bsp": {
					throw new Error("bsp")
				}
			}
		}
	)

	const fileSystemWatcherFactory = new FileSystemWatcherFactory()

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands
	subscriptions.push(commands.registerCommand("vscode-vdf.executeCommands", executeCommands))
	subscriptions.push(commands.registerCommand("vscode-vdf.selectTeamFortress2Folder", selectTeamFortress2Folder))
	subscriptions.push(commands.registerCommand("vscode-vdf.setVTFFlags", setVTFFlags))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates(teamFortress2Folder$, fileSystemMountPointFactory, fileSystemWatcherFactory)))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.listPopfileClassIcons", listPopfileClassIcons(teamFortress2Folder$, fileSystemMountPointFactory, fileSystemWatcherFactory)))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showWaveStatusPreviewToSide", showWaveStatusPreviewToSide(context, teamFortress2Folder$, fileSystemMountPointFactory, fileSystemWatcherFactory, null)))
	subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	subscriptions.push(window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor))
	subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context.extensionUri, fileSystemWatcherFactory, subscriptions)))

	// Workspace
	subscriptions.push(workspace.registerFileSystemProvider(RemoteResourceFileSystemProvider.scheme, new RemoteResourceFileSystemProvider(), { isCaseSensitive: false, isReadonly: true }))

	// Language Server
	const onDidOpenTextDocument = async (e: TextDocument): Promise<void> => {
		const result = VSCodeVDFLanguageIDSchema.safeParse(e.languageId)
		if (result.success) {
			await startServer(result.data)
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
		subscriptions.push(languageStatusItem)

		languageStatusItem.text = "$(cloud)"
		languageStatusItem.command = {
			title: RemoteResourceFileSystemProvider.base,
			command: "vscode.open",
			arguments: [RemoteResourceFileSystemProvider.base]
		}

		let teamFortress2Folder = await firstValueFrom(teamFortress2Folder$)

		const client = languageClients[languageId] = new Client(
			context,
			languageClients,
			startServer,
			fileSystemMountPointFactory,
			fileSystemWatcherFactory,
			null,
			new LanguageClient(
				`${languageId}-language-server`,
				`${name} Language Server`,
				{
					documentSelector: [
						languageId
					],
					initializationOptions: () => ({
						teamFortress2Folder: teamFortress2Folder.toJSON()
					}),
					middleware: middleware[languageId],
				} satisfies LanguageClientOptions,
				new Worker(serverModule),
			)
		)

		subscriptions.push(new Disposable(() => client[Symbol.asyncDispose]()))
		await client.start()
	}

	workspace.textDocuments.forEach(onDidOpenTextDocument)
	subscriptions.push(workspace.onDidOpenTextDocument(onDidOpenTextDocument))
}
