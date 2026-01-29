import { initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { BSP } from "bsp"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { catchError, concatMap, filter, firstValueFrom, map, Observable, of, share, shareReplay, startWith, switchMap, type ObservedValueOf } from "rxjs"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import vscode, { commands, DocumentSymbol, ViewColumn, window, workspace, type ConfigurationChangeEvent, type ExtensionContext, type TextDocumentChangeEvent, type TextEditor, type WebviewPanel } from "vscode"
import { VTF, VTFToPNG } from "vtf-png"
import { z } from "zod"
import { Popfile } from "../Popfile"
import { TRPCImageRouter } from "../TRPCImageRouter"
import { TRPCWebViewRequestHandler } from "../TRPCWebViewRequestHandler"
import { initBSP } from "../wasm/bsp"
import { initVTFPNG } from "../wasm/vtf"

export type WaveStatus = Awaited<ReturnType<typeof getWaveStatus>>

export interface HUDEnemyData {
	count: number
	classIconName: string | null
	miniboss: boolean
	alwayscrit: boolean
}

const enum Type {
	Normal,
	Support,
	Mission,
}

async function getWaveStatus(popfile: Popfile) {

	const TANK_PATH = "materials/hud/leaderboard_class_tank.vmt"

	const starting = parseInt(popfile.waveSchedule.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "StartingCurrency".toLowerCase())?.detail ?? "") || 0
	const eventPopfile = popfile.waveSchedule.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "EventPopfile".toLowerCase())?.detail?.toLowerCase() == "Halloween".toLowerCase()
		? <const>"Halloween"
		: null
	const templates = await popfile.templates()

	function attribute(documentSymbols: VDFDocumentSymbol[] | undefined, key: string): boolean {
		if (!documentSymbols) {
			return false
		}

		const value = documentSymbols.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Attributes".toLowerCase() && documentSymbol.detail?.toLowerCase() == key.toLowerCase())?.detail
		if (value) {
			return true
		}

		for (const eventChangeAttributes of documentSymbols.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "EventChangeAttributes".toLowerCase() && documentSymbol.children)) {
			const defaultEvent = eventChangeAttributes.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Default".toLowerCase())?.children
			const value = attribute(defaultEvent, key)
			if (value) {
				return true
			}
		}

		const templateName = documentSymbols.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
		if (templateName) {
			const value = attribute(templates.get(templateName)?.documentSymbols, key)
			if (value) {
				return true
			}
		}

		return false
	}

	function getClassIcon(documentSymbols?: VDFDocumentSymbol[]): string | null {
		if (!documentSymbols) {
			return null
		}

		const icon = documentSymbols.findLast(({ key }) => key.toLowerCase() == "ClassIcon".toLowerCase())?.detail?.toLowerCase()
		if (icon) {
			return icon
		}

		const TFClass = documentSymbols.findLast(({ key }) => key.toLowerCase() == "Class".toLowerCase())?.detail?.toLowerCase()
		if (TFClass) {
			if (TFClass == "Demoman".toLowerCase()) {
				return "Demo".toLowerCase()
			}
			else if (TFClass == "Heavyweapons".toLowerCase()) {
				return "Heavy".toLowerCase()
			}
			else {
				return TFClass
			}
		}

		const templateName = documentSymbols.findLast(({ key }) => key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
		if (templateName) {
			const icon = getClassIcon(templates.get(templateName)?.documentSymbols)
			if (icon) {
				return icon
			}
		}

		return null
	}

	const missions = popfile.waveSchedule.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Mission".toLowerCase() && documentSymbol.children)

	const waves = popfile.waveSchedule
		.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children)
		.map((documentSymbol, index) => {
			let currency = 0

			const icons = {
				normal: <HUDEnemyData[]>[],
				support: <HUDEnemyData[]>[],
			}

			for (const mission of missions) {

				const objective = mission.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Objective".toLowerCase())
				if (objective?.detail?.toLowerCase() == "DestroySentries".toLowerCase()) {
					continue
				}

				let beginAtWave = parseInt(mission.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "BeginAtWave".toLowerCase())?.detail ?? "")
				let runForThisManyWaves = parseInt(mission.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "RunForThisManyWaves".toLowerCase())?.detail ?? "")

				if (!isNaN(beginAtWave)) {
					beginAtWave += -1
					if (beginAtWave > index) {
						continue
					}
					else if (!isNaN(runForThisManyWaves)) {
						if ((beginAtWave + runForThisManyWaves) <= index) {
							continue
						}
					}
				}

				const spawner = mission.children!.findLast((documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
				if (spawner) {
					addSpawner({
						type: Type.Mission,
						spawner: spawner,
						totalCount: 1
					})
				}
			}

			let expected = 0
			let actual = 0

			function addSpawner({ type, spawner, totalCount }: { type: Type, spawner: VDFDocumentSymbol, totalCount: number }) {
				const populationSpawnerKeys = [
					"Mob",
					"RandomChoice",
					"SentryGun",
					"Squad",
					"Tank",
					"TFBot",
				].map((key) => key.toLowerCase())

				switch (spawner.key.toLowerCase()) {
					case "TFBot".toLowerCase(): {
						if (totalCount > 0 || type == Type.Support) {
							addIcon({
								type,
								icon: getClassIcon(spawner.children)?.toLowerCase() ?? null,
								count: totalCount,
								miniboss: attribute(spawner.children, "MiniBoss".toLowerCase()),
								alwayscrit: attribute(spawner.children, "AlwaysCrit".toLowerCase()),
							})
						}
						break
					}
					case "Squad".toLowerCase(): {
						if (!spawner.children) {
							return
						}

						const children = spawner.children.filter((documentSymbol) => populationSpawnerKeys.includes(documentSymbol.key.toLowerCase()))

						for (const i of Array.from({ length: totalCount }).keys()) {
							const member = children[i % children.length]
							switch (member.key.toLowerCase()) {
								case "TFBot".toLowerCase(): {
									addIcon({
										type: type,
										icon: getClassIcon(member.children),
										count: 1,
										miniboss: attribute(member.children, "MiniBoss".toLowerCase()),
										alwayscrit: attribute(member.children, "AlwaysCrit".toLowerCase()),
									})
									break
								}
								case "Tank".toLowerCase(): {
									if (!icons.support.some((value) => value.classIconName == TANK_PATH)) {
										addIcon({
											type: type,
											icon: getClassIcon(member.children) ?? "Tank".toLowerCase(),
											count: 1,
											miniboss: type != Type.Mission,
											alwayscrit: attribute(member.children, "AlwaysCrit".toLowerCase()),
										})
									}
									break
								}
							}
						}
						break
					}
					case "RandomChoice".toLowerCase(): {
						if (!spawner.children) {
							return
						}

						const children = spawner.children.filter((documentSymbol) => populationSpawnerKeys.includes(documentSymbol.key.toLowerCase()))

						for (const i of Array.from({ length: totalCount }).keys()) {
							const member = children[Math.floor(Math.random() * children.length)]
							switch (member.key.toLowerCase()) {
								case "TFBot".toLowerCase(): {
									addIcon({
										type: type,
										icon: getClassIcon(member.children),
										count: 1,
										miniboss: attribute(member.children, "MiniBoss".toLowerCase()),
										alwayscrit: attribute(member.children, "AlwaysCrit".toLowerCase()),
									})
									break
								}
								case "Tank".toLowerCase(): {
									if (!icons.support.some((value) => value.classIconName == TANK_PATH)) {
										addIcon({
											type: type,
											icon: getClassIcon(member.children) ?? "Tank".toLowerCase(),
											count: 1,
											miniboss: type != Type.Mission,
											alwayscrit: attribute(member.children, "AlwaysCrit".toLowerCase()),
										})
									}
									break
								}
							}
						}
						break
					}
					case "Tank".toLowerCase(): {
						if (!icons.support.some((value) => value.classIconName == TANK_PATH)) {
							addIcon({
								type: type,
								icon: getClassIcon(spawner.children) ?? "Tank".toLowerCase(),
								count: totalCount,
								miniboss: type != Type.Mission,
								alwayscrit: false,
							})
						}
						break
					}
				}
			}

			function addIcon({ type, icon, count, miniboss, alwayscrit }: {
				type: Type,
				icon: string | null,
				count: number,
				miniboss: boolean,
				alwayscrit: boolean,
			}) {
				const arr = {
					[Type.Normal]: icons.normal,
					[Type.Support]: icons.support,
					[Type.Mission]: icons.support,
				}[type]

				const path = icon && `materials/hud/leaderboard_class_${icon.toLowerCase()}.vmt`
				const existing = arr.find((value) => value.classIconName == path)
				if (existing) {
					existing.count += count
					existing.miniboss ||= miniboss
					existing.alwayscrit ||= alwayscrit
				}
				else {
					arr.push({
						count: count,
						classIconName: path,
						miniboss: type != Type.Mission && miniboss,
						alwayscrit: alwayscrit,
					})
				}

				if (type == Type.Normal) {
					actual += count
				}
			}

			const waveSpawns = documentSymbol.children!.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children)

			for (const waveSpawn of waveSpawns) {

				const totalCurrency = parseInt(waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCurrency".toLowerCase())?.detail ?? "") || 0
				if (totalCurrency > 0) {
					currency += totalCurrency
				}

				const support = waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Support".toLowerCase())?.detail != undefined

				// @ts-ignore
				const totalCount = parseInt(waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCount".toLowerCase())?.detail) || 0

				if (!support) {
					if (totalCount > 0) {
						expected += totalCount
					}
					else {
						continue
					}
				}

				const spawner = waveSpawn.children!.findLast((documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
				if (spawner) {
					addSpawner({
						type: support ? Type.Support : Type.Normal,
						spawner: spawner,
						totalCount: totalCount,
					})
				}
			}

			const { miniboss = [], normal = [] } = Object.groupBy(icons.normal, (item) => item.miniboss ? "miniboss" : "normal")

			return {
				currency,
				percentage: expected != 0
					? actual / expected
					: 1,
				icons: {
					miniboss: miniboss,
					normal: normal,
					support: icons.support,
				},
			}
		})

	return {
		starting,
		eventPopfile,
		waves,
	}
}

export function showWaveStatusPreviewToSide(context: ExtensionContext, fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>) {

	const webviewPanels = new Map<string, WebviewPanel>()

	function send(command: string) {
		return (arg: any) => {
			const webviewPanel = webviewPanels.get(arg.id)
			if (webviewPanel) {
				webviewPanel.reveal()
				webviewPanel.webview.postMessage({ type: "context_menu", command: command })
			}
		}
	}

	context.subscriptions.push(
		commands.registerCommand("vscode-vdf.waveStatusPreviewSaveImageAs", send("vscode-vdf.waveStatusPreviewSaveImageAs")),
		commands.registerCommand("vscode-vdf.waveStatusPreviewCopyImage", send("vscode-vdf.waveStatusPreviewCopyImage")),
	)

	return async ({ document }: TextEditor) => {
		if (document.languageId != "popfile") {
			window.showWarningMessage(document.languageId)
			return
		}

		const id = document.uri.toString()
		const name = posix.parse(new Uri(document.uri).basename()).name

		await Promise.all([
			initBSP(context),
			initVTFPNG(context),
		])

		const webviewPanel = window.createWebviewPanel(
			"vscode-vdf.waveStatusPreview",
			name,
			{ viewColumn: ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		)

		const stack = new AsyncDisposableStack()
		webviewPanel.onDidDispose(() => stack.disposeAsync())

		webviewPanels.set(id, webviewPanel)
		stack.defer(() => {
			webviewPanels.delete(id)
		})

		const fileSystem = await fileSystemMountPointFactory.get({ type: "tf2" })
		stack.use(fileSystem)

		const onDidChangeTextDocument$ = new Observable<TextDocumentChangeEvent>((subscriber) => {
			const disposable = workspace.onDidChangeTextDocument((event) => subscriber.next(event))
			return () => disposable.dispose()
		}).pipe(
			share()
		)

		const waveStatus$ = onDidChangeTextDocument$.pipe(
			filter((event) => [".pop", ".vmt"].includes(posix.extname(event.document.uri.fsPath))),
			map(() => null),
			startWith(null),
			concatMap(async () => {
				try {
					const popfile = new Popfile(new Uri(document.uri), document.getText(), fileSystem)
					return await getWaveStatus(popfile)
				}
				catch (error) {
					return null
				}
			}),
			filter((value) => value != null)
		)

		function vtf(path: string) {
			return fileSystem.resolveFile(path).pipe(
				switchMap((uri) => {
					if (!uri) {
						return of(null)
					}

					return onDidChangeTextDocument$.pipe(
						filter((event) => Uri.equals(uri, new Uri(event.document.uri))),
						map(() => undefined),
						startWith(undefined),
						concatMap(async () => await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", vscode.Uri.from(uri))),
						switchMap((documentSymbols) => {
							const header = documentSymbols?.values().map((documentSymbol) => documentSymbol.children).find((children) => children != undefined)
							if (!header) {
								return of(null)
							}

							const baseTexture = header.find((documentSymbol) => documentSymbol.name.toLowerCase() == "$baseTexture".toLowerCase())?.detail ?? null
							if (!baseTexture) {
								return of(null)
							}

							return fileSystem.resolveFile(`materials/${baseTexture.replaceAll("\\", "/")}.vtf`).pipe(
								concatMap(async (uri) => {
									if (!uri) {
										return null
									}
									const vtf = new VTF(await workspace.fs.readFile(uri))
									return {
										width: vtf.header.width,
										height: vtf.header.height,
										buf: VTFToPNG(vtf, 4096)
									}
								}),
								catchError((err) => {
									console.dir(err)
									return of(null)
								})
							)
						})
					)
				})
			)
		}

		const configuration$ = new Observable<ConfigurationChangeEvent>((subscriber) => {
			const disposable = workspace.onDidChangeConfiguration((event) => {
				subscriber.next(event)
			})
			return () => disposable.dispose()
		}).pipe(
			filter((event) => event.affectsConfiguration("vscode-vdf.popfile.waveStatusPreview")),
			map(() => null),
			startWith(null),
			map(() => VSCodeVDFConfigurationSchema.shape.popfile.shape.waveStatusPreview.parse(workspace.getConfiguration("vscode-vdf.popfile.waveStatusPreview"))),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		const t = initTRPC.create({
			transformer: devalueTransformer({ reducers: {}, revivers: {} }),
			isDev: true
		})

		const router = t.mergeRouters(
			TRPCImageRouter(t),
			t.router({
				configuration: t
					.procedure
					.subscription(({ signal }) => {
						return observableToAsyncIterable<VSCodeVDFConfiguration["popfile"]["waveStatusPreview"]>(
							configuration$,
							signal!
						)
					}),
				skyname: t
					.procedure
					.subscription(async ({ signal }) => {
						const basename = new Uri(document.uri).basename()
						const maps = await fileSystem.readDirectory("maps", { pattern: "mvm_*.bsp" })
						const map = maps
							.values()
							.filter(([, type]) => type == 1)
							.find(([name]) => basename.startsWith(posix.parse(name).name))
							?.[0]

						if (!map) {
							return observableToAsyncIterable<null>(of(null), signal!)
						}

						const uri = await firstValueFrom(fileSystem.resolveFile(`maps/${map}`))
						if (!uri) {
							return observableToAsyncIterable<null>(of(null), signal!)
						}

						const buf = await workspace.fs.readFile(uri)
						const bsp = new BSP(buf)
						const entities = bsp.entities()

						const skyname = entities[0]["skyname"]

						// bk
						// ft
						// lf
						// rt
						return observableToAsyncIterable<ObservedValueOf<ReturnType<typeof vtf>> | null>(vtf(`materials/skybox/${skyname}ft.vmt`), signal!)
					}),
				png: t
					.procedure
					.input(
						z.object({
							path: z.string(),
						})
					)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<ObservedValueOf<ReturnType<typeof vtf>>>(vtf(input.path), signal!)
					}),
				font: t
					.procedure
					.input(
						z.object({
							path: z.string(),
						})
					)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<Uint8Array | null>(
							fileSystem.resolveFile(input.path).pipe(
								concatMap(async (uri) => uri && new Uint8Array(await workspace.fs.readFile(uri)))
							),
							signal!
						)
					}),
				tokens: t.procedure.subscription(({ signal }) => {
					const tokens = (map: Map<string, string>) => ({
						TF_PVE_WaveCount: map.get("TF_PVE_WaveCount")!,
						TF_MVM_Support: map.get("TF_MVM_Support")!,
					})

					return observableToAsyncIterable<ReturnType<typeof tokens>>(
						configuration$.pipe(
							switchMap((configuration) => {
								const files: Record<string, string> = {
									// "korean": "koreana",
									"simplified_chinese": "schinese",
									"traditional_chinese": "tchinese",
									"latam_spanish": "latam"
								}
								return fileSystem.resolveFile(`resource/tf_${files[configuration.language] ?? configuration.language}.txt`)
							}),
							concatMap(async (uri) => new TextDecoder("utf-16").decode(await workspace.fs.readFile(uri!))),
							map((text) => {
								const documentSymbols = getVDFDocumentSymbols(text, { multilineStrings: true })

								const lang = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "lang".toLowerCase())?.children
								if (!lang) {
									throw new Error("lang")
								}

								const tokens = lang.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Tokens".toLowerCase())?.children
								if (!tokens) {
									throw new Error("Tokens")
								}

								return new Map(
									tokens
										.filter((documentSymbol) => documentSymbol.detail != undefined)
										.map((documentSymbol) => [documentSymbol.key, documentSymbol.detail!])
								)
							}),
							map(tokens)
						),
						signal!
					)
				}),
				waveStatus: t
					.procedure
					.subscription(({ signal }) => observableToAsyncIterable<ObservedValueOf<typeof waveStatus$>>(waveStatus$, signal!)),
				openSettings: t
					.procedure
					.query(async () => {
						await commands.executeCommand("workbench.action.openSettings", "vscode-vdf.popfile.waveStatusPreview")
					}),
			})
		)

		stack.use(TRPCWebViewRequestHandler(webviewPanel.webview, router))

		const dist = vscode.Uri.joinPath(context.extensionUri, "apps/wavestatus-preview/dist")
		const html = new TextDecoder("utf-8").decode(await workspace.fs.readFile(vscode.Uri.joinPath(dist, "index.html")))
		webviewPanel.webview.html = html
			.replaceAll("%ID%", id)
			.replaceAll("%BASE%", `${webviewPanel.webview.asWebviewUri(dist).toString()}/`)

		return router
	}
}
