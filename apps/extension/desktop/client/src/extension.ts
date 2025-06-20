import { execSync } from "child_process"
import { Client, VSCodeVDFLanguageIDSchema, VSCodeVDFLanguageNameSchema, type VSCodeVDFLanguageID } from "client"
import { FileSystemWatcherFactory } from "client/FileSystemWatcherFactory"
import { RemoteResourceFileSystemProvider } from "client/RemoteResourceFileSystemProvider"
import { VTFEditor } from "client/VTF/VTFEditor"
import { JSONToVDF } from "client/commands/JSONToVDF"
import { VDFToJSON } from "client/commands/VDFToJSON"
import { copyKeyValuePath } from "client/commands/copyKeyValuePath"
import { executeCommands } from "client/commands/executeCommands"
import { extractVPKFileToWorkspace } from "client/commands/extractVPKFileToWorkspace"
import { importPopfileTemplates } from "client/commands/importPopfileTemplates"
import { selectTeamFortress2Folder } from "client/commands/selectTeamFortress2Folder"
import { setVTFFlags } from "client/commands/setVTFFlags"
import { showReferences } from "client/commands/showReferences"
import { showWaveStatusPreviewToSide } from "client/commands/showWaveStatusPreviewToSide"
import { onDidChangeActiveTextEditor } from "client/decorations"
import { createMiddleware } from "client/middleware"
import { Uri } from "common/Uri"
import { homedir } from "os"
import { join, posix, win32 } from "path"
import { concat, defer, distinctUntilChanged, map, Observable, shareReplay } from "rxjs"
import { VDF } from "vdf"
import { commands, ConfigurationTarget, Disposable, FileSystemError, FileType, languages, LanguageStatusSeverity, window, workspace, type ExtensionContext, type TextDocument } from "vscode"
import { LanguageClient, TransportKind, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node"
import { z } from "zod"
import { FileSystemMountPointFactory } from "./FileSystemMountPointFactory"
import { VPKFileSystemProvider } from "./VPK/VPKFileSystemProvider"

const languageClients: { -readonly [P in VSCodeVDFLanguageID]?: Client<LanguageClient> } = {}

export function activate(context: ExtensionContext): void {

	const teamFortress2FolderSchema = z.string().transform((arg) => {
		// Convert Windows drive letter to lower case to be consistent with VSCode Uris
		const path = arg.trim().replace(/[a-z]{1}:/i, (substring) => substring.toLowerCase()).replaceAll('\\', '/')
		return new Uri({
			scheme: "file",
			authority: "",
			path: path,
			query: "",
			fragment: ""
		})
	})

	async function check(setting: string) {
		const result = teamFortress2FolderSchema.safeParse(setting)
		if (!result.success) {
			return null
		}

		const uri = result.data

		const exists = await Promise.all([
			workspace.fs.stat(uri).then((stat) => stat.type == FileType.Directory, () => false),
			workspace.fs.stat(uri.joinPath("tf/gameinfo.txt")).then((stat) => stat.type == FileType.File, () => false),
		])

		return exists.every((value) => value)
			? uri
			: null
	}

	const teamFortress2Folder$ = concat(
		defer(async () => {
			const configuration = workspace.getConfiguration("vscode-vdf")
			let setting = configuration.get<string>("teamFortress2Folder")!

			let uri = await check(setting)
			if (uri != null) {
				return uri
			}

			const decoder = new TextDecoder("utf-8")

			const libraryFoldersSchema = z.object({
				libraryfolders: z.record(z.object({
					path: z.string(),
					apps: z.record(z.string())
				}))
			})

			async function steam(installPath: string) {
				try {
					const buf = await workspace.fs.readFile(new Uri({ scheme: "file", path: posix.join(installPath, "steamapps/libraryfolders.vdf") }))
					const text = decoder.decode(buf)
					const { libraryfolders } = libraryFoldersSchema.parse(VDF.parse(text))

					const path = Object.values(libraryfolders).find((folder) => Object.keys(folder.apps).includes("440"))?.path
					if (!path) {
						return null
					}

					const uri = new Uri({ scheme: "file", path: posix.join(path.replaceAll(/[\\]+/g, "/"), "steamapps/common/Team Fortress 2") })
					if (await workspace.fs.stat(uri).then(() => true, () => false)) {
						return uri
					}
				}
				catch (error) {
					if (!(error instanceof FileSystemError) || error.code != "FileNotFound") {
						console.error(error)
					}

					return null
				}
			}

			function update(uri: Uri) {
				configuration.update("teamFortress2Folder", uri.fsPath.replace(/[a-z]{1}:/i, (substring) => substring.toUpperCase()).replaceAll(/[\\]+/g, "/"), ConfigurationTarget.Global)
			}

			switch (process.platform) {
				case "win32": {
					function parseRegistryResult(str: string) {
						const TAB = "    "
						const result = new Map<string, Map<string, string>>()
						let active: string | null = null

						for (const line of str.split(/\r?\n/)) {
							if (line == "") {
								continue
							}
							else if (line.startsWith(TAB)) {
								if (active == null) {
									throw new Error()
								}

								let map = result.get(active)
								if (!map) {
									map = new Map()
									result.set(active, map)
								}

								const [key, type, value] = line.trim().split(TAB)
								map.set(key, value)
							}
							else {
								active = line
							}
						}

						return result
					}

					const key = win32.join("HKEY_LOCAL_MACHINE\\SOFTWARE", process.arch == "x64" ? "Wow6432Node" : "", "Valve\\Steam")
					const result = parseRegistryResult(decoder.decode(execSync(`REG QUERY ${key} /v InstallPath`)))

					const installPath = result.get(key)?.get("InstallPath")
					if (installPath) {
						const result = await steam(`/${installPath.replaceAll("\\", "/")}`)
						if (result != null) {
							update(result)
							return result
						}
					}
					break
				}
				case "linux": {
					const home = homedir()
					const paths = [
						/* Steam */ posix.join(home, ".local/share/Steam"),
						/* Steam */ posix.join(home, ".steam/steam"),
						/* Flatpak */ posix.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
					]

					for (const path of paths) {
						const result = await steam(path)
						if (result != null) {
							update(result)
							return result
						}
					}

					break
				}
			}

			while (true) {
				const result = await window.showErrorMessage(`Team Fortress 2 installation not found at "${setting}". Please select path to Team Fortress 2 folder`, "Select Folder", "Ignore")
				switch (result) {
					case "Select Folder": {
						const result = await window.showOpenDialog({
							canSelectFiles: false,
							canSelectFolders: true,
							canSelectMany: false,
						})

						if (result && result.length) {
							const path = result[0].fsPath.replaceAll("\\", "/")
							const uri = await check(path)
							if (uri != null) {
								update(uri)
								return uri
							}

							setting = path
						}

						break
					}
					case "Ignore":
					case undefined: {
						return null
					}
				}
			}
		}),
		new Observable<Uri | null>((subscriber) => {
			const disposable = workspace.onDidChangeConfiguration(async (event) => {
				if (event.affectsConfiguration("vscode-vdf.teamFortress2Folder")) {
					const setting = workspace.getConfiguration("vscode-vdf").get<string>("teamFortress2Folder")!
					const uri = await check(setting)
					subscriber.next(uri)
					if (uri == null) {
						window.showWarningMessage(`Team Fortress 2 installation not found at "${setting}".`)
					}
				}
			})

			return () => disposable.dispose()
		})
	).pipe(
		map((uri) => uri ?? new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" })),
		distinctUntilChanged((a, b) => Uri.equals(a, b)),
		shareReplay(1)
	)

	const fileSystemMountPointFactory = new FileSystemMountPointFactory(context, teamFortress2Folder$)
	const fileSystemWatcherFactory = new FileSystemWatcherFactory()

	// https://code.visualstudio.com/api/references/contribution-points#contributes
	// https://code.visualstudio.com/api/references/vscode-api

	// Commands
	context.subscriptions.push(commands.registerCommand("vscode-vdf.executeCommands", executeCommands))
	context.subscriptions.push(commands.registerCommand("vscode-vdf.selectTeamFortress2Folder", selectTeamFortress2Folder))
	context.subscriptions.push(commands.registerCommand("vscode-vdf.setVTFFlags", setVTFFlags))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.copyKeyValuePath", copyKeyValuePath))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.extractVPKFileToWorkspace", extractVPKFileToWorkspace))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.importPopfileTemplates", importPopfileTemplates(fileSystemMountPointFactory)))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.JSONToVDF", JSONToVDF))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showReferences", showReferences))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.showWaveStatusPreviewToSide", showWaveStatusPreviewToSide(context, fileSystemMountPointFactory)))
	context.subscriptions.push(commands.registerTextEditorCommand("vscode-vdf.VDFToJSON", VDFToJSON))

	// Window
	context.subscriptions.push(window.onDidChangeActiveTextEditor(onDidChangeActiveTextEditor))
	context.subscriptions.push(window.registerCustomEditorProvider("vscode-vdf.VTFEditor", new VTFEditor(context.extensionUri, fileSystemWatcherFactory, context.subscriptions)))

	// Workspace
	context.subscriptions.push(workspace.registerFileSystemProvider("vpk", new VPKFileSystemProvider(), { isCaseSensitive: false, isReadonly: true }))

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

		const serverModule = context.asAbsolutePath(join("apps/extension/desktop/servers/dist", `${languageId}.js`))
		const name = VSCodeVDFLanguageNameSchema.shape[languageId].value

		const languageStatusItem = languages.createLanguageStatusItem(`vscode-vdf.${name.replaceAll(" ", "")}LanguageStatusItem`, languageId)
		context.subscriptions.push(languageStatusItem)
		languageStatusItem.busy = true

		const subscription = teamFortress2Folder$.subscribe((teamFortress2Folder) => {
			switch (teamFortress2Folder.scheme) {
				case "file":
					languageStatusItem.text = `$(folder-active) ${teamFortress2Folder.fsPath.replace(/[a-z]{1}:/i, (substring) => substring.toUpperCase())}`
					languageStatusItem.severity = LanguageStatusSeverity.Information
					languageStatusItem.command = undefined
					break
				case RemoteResourceFileSystemProvider.scheme:
					languageStatusItem.text = `$(cloud) ${RemoteResourceFileSystemProvider.base}`
					languageStatusItem.severity = LanguageStatusSeverity.Warning
					languageStatusItem.command = {
						title: "Select Team Fortress 2 folder",
						command: "vscode-vdf.selectTeamFortress2Folder"
					}
					break
				default:
					throw new Error()
			}

			languageStatusItem.busy = false
		})

		context.subscriptions.push(new Disposable(() => subscription.unsubscribe()))

		const options = {
			execArgv: [
				"--nolazy",
				`--inspect=${6000 + Object.keys(VSCodeVDFLanguageNameSchema.shape).indexOf(languageId)}`
			]
		}

		const client = languageClients[languageId] = new Client<LanguageClient>(
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
					run: {
						module: serverModule,
						transport: TransportKind.ipc,
						...(process.env.NODE_ENV != "production" && {
							options: options
						})
					},
					debug: {
						module: serverModule,
						transport: TransportKind.ipc,
						options: options
					}
				} satisfies ServerOptions,
				{
					documentSelector: [
						languageId
					],
					middleware: middleware[languageId],
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
	context.subscriptions.push(workspace.onDidOpenTextDocument(onDidOpenTextDocument))
}
