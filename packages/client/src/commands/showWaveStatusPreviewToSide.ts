import { initTRPC } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { BSP } from "bsp"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { usingAsync } from "common/operators/usingAsync"
import { findMap } from "common/popfile/findMap"
import { populationSpawnerKeys } from "common/popfile/populationSpawnerKeys"
import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { catchError, combineLatest, concat, concatMap, filter, firstValueFrom, from, map, Observable, of, ReplaySubject, share, startWith, switchAll, switchMap, take, withLatestFrom, type ObservedValueOf } from "rxjs"
import type { RangeLike } from "vdf"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import vscode, { commands, DocumentSymbol, ThemeIcon, ViewColumn, window, workspace, type ConfigurationChangeEvent, type ExtensionContext, type TextDocumentChangeEvent, type TextEditor, type WebviewPanel } from "vscode"
import { VTF, VTFToPNG } from "vtf-png"
import { z } from "zod"
import type { FileSystemWatcherFactory } from "../FileSystemWatcherFactory"
import { MissionPopfile } from "../Popfile"
import { TRPCImageRouter } from "../TRPCImageRouter"
import { TRPCWebViewRequestHandler } from "../TRPCWebViewRequestHandler"
import { VSCodeDocumentGetTextSchema } from "../VSCodeSchemas"
import { initBSP } from "../wasm/bsp"
import { initVTFPNG } from "../wasm/vtf"

function transformDifficulty(arg: string): string {
	switch (arg.toLowerCase()) {
		case "nor": return "normal"
		case "int": return "intermediate"
		case "adv": return "advanced"
		case "exp": return "expert"
		default: return arg
	}
}

const difficultySchema = z.enum(["normal", "intermediate", "advanced", "expert"])

export interface Meta {
	/** Map name without `mvm_` prefix or `.bsp` extension */
	map: string | null,
	reverse: boolean,
	difficulty: z.infer<typeof difficultySchema> | null,
	mission: string,
}

export interface Wave {
	currency: number
	percentage: number
	icons: {
		miniboss: HUDEnemyData[]
		normal: HUDEnemyData[]
		support: HUDEnemyData[]
	}
}

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

export function showWaveStatusPreviewToSide(context: ExtensionContext, fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>, fileSystemWatcherFactory: FileSystemWatcherFactory) {

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

		const webviewPanel = window.createWebviewPanel(
			"vscode-vdf.waveStatusPreview",
			name,
			{ viewColumn: ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		)

		// https://microsoft.github.io/vscode-codicons/dist/codicon.html
		webviewPanel.iconPath = new ThemeIcon("output")

		const stack = new AsyncDisposableStack()
		webviewPanel.onDidDispose(() => stack.disposeAsync())

		webviewPanels.set(id, webviewPanel)
		stack.defer(() => void webviewPanels.delete(id))

		const dispose$ = new ReplaySubject<void>(1)
		stack.defer(() => dispose$.next())

		const shareReplayUntilDisposed = <T>() => share<T>({
			connector: () => new ReplaySubject(1),
			resetOnRefCountZero: () => dispose$
		})

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
			shareReplayUntilDisposed()
		)

		const fileSystem$ = usingAsync(async () => await fileSystemMountPointFactory.get({ type: "tf2" })).pipe(
			shareReplayUntilDisposed()
		)

		const language$ = combineLatest({ fileSystem: fileSystem$, configuration: configuration$ }).pipe(
			switchMap(({ fileSystem, configuration }) => {
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

				return new Map<Lowercase<string>, string>(
					tokens
						.filter((documentSymbol) => documentSymbol.detail != undefined)
						.map((documentSymbol) => [documentSymbol.key.toLowerCase() as Lowercase<string>, documentSymbol.detail!])
				)
			}),
			shareReplayUntilDisposed(),
		)

		const meta$ = fileSystem$.pipe(
			concatMap(async (fileSystem) => {
				const items_game = await Promise.try(async () => {
					const uri = await firstValueFrom(fileSystem.resolveFile("scripts/items/items_game.txt"))
					const buf = await workspace.fs.readFile(uri!)
					const text = new TextDecoder("utf-8").decode(buf)
					const documentSymbols = getVDFDocumentSymbols(text, { multilineStrings: false })
					return documentSymbols[0].children!
				})

				const mvm_maps = items_game.find((documentSymbol) => documentSymbol.key.toLowerCase() == "mvm_maps")?.children!

				for (const map of mvm_maps) {
					const missions = map.children!.find((documentSymbol) => documentSymbol.key.toLowerCase() == "missions")?.children!
					const mission = missions.find((documentSymbol) => documentSymbol.key.toLowerCase() == name.toLowerCase())?.children
					if (mission) {
						let display_name = mission.find((documentSymbol) => documentSymbol.key.toLowerCase() == "display_name")?.detail!
						if (display_name[0] == "#") {
							display_name = display_name.substring(1)
						}

						const difficulty = difficultySchema.safeParse(mission.find((documentSymbol) => documentSymbol.key.toLowerCase() == "difficulty")?.detail!).data
						const language = await firstValueFrom(language$)
						return {
							map: map.key.substring("mvm_".length),
							reverse: false,
							difficulty: difficulty ?? null,
							mission: language.get(display_name.toLowerCase() as Lowercase<string>) ?? name
						}
					}
				}

				const label = (value: string) => {
					return value.split("_").map((value) => `${value.at(0)?.toUpperCase() ?? ""}${value.substring(1).toLowerCase()}`).join(" ")
				}

				const bsp = await findMap(new Uri(document.uri), fileSystem)
				if (bsp != null) {
					const pattern = /^((?<reverse>rev)_)?((?<difficulty>nor(mal)?|int(ermediate)?|adv(anced)?|exp(ert)?)_)?(?<mission>.+)$/gmi
					const string = name.substring(posix.parse(bsp).name.length + "_".length)
					const { reverse, difficulty, mission } = pattern.exec(string)?.groups ?? {}
					return {
						map: posix.parse(bsp).name.substring("mvm_".length),
						reverse: reverse != undefined,
						difficulty: difficulty != undefined
							? difficultySchema.safeParse(transformDifficulty(difficulty)).data ?? null
							: null,
						mission: mission != undefined
							? label(mission)
							: name,
					}
				}
				else {
					let mapSegments: string[] | null = null
					let reverse: boolean | null = null
					let difficulty: z.infer<typeof difficultySchema> | null = null
					let missionSegments: string[] | null = null

					let mapCompleted = false

					for (const segment of name.substring("mvm_".length).split("_")) {
						let str = segment.toLowerCase()
						if (str == "rev") {
							mapCompleted = true
							if (reverse == null) {
								reverse = true
							}
						}
						else if (["nor", "normal", "int", "intermediate", "adv", "advanced", "exp", "expert"].includes(str)) {
							mapCompleted = true
							difficulty = difficultySchema.safeParse(transformDifficulty(segment)).data ?? null
						}
						else {
							if (!mapCompleted) {
								(mapSegments ??= []).push(segment)
							}
							else {
								(missionSegments ??= []).push(segment)
							}
						}
					}

					return {
						map: mapSegments?.join("_") ?? null,
						reverse: reverse ?? false,
						difficulty: difficulty,
						mission: missionSegments != null
							? label(missionSegments.join("_"))
							: name,
					}
				}
			}),
			take(1),
			shareReplayUntilDisposed()
		)

		const onDidChangeTextDocument$ = new Observable<TextDocumentChangeEvent>((subscriber) => {
			const disposable = workspace.onDidChangeTextDocument((event) => subscriber.next(event))
			return () => disposable.dispose()
		}).pipe(
			share()
		)

		const cache = new Map<number, Map<string, Wave>>()
		stack.defer(() => cache.clear())

		const waveStatus$ = combineLatest({
			meta: meta$,
			popfile: fileSystem$.pipe(
				map((fileSystem) => {
					return new MissionPopfile(
						new Uri(document.uri),
						concat(
							of({ getText: (range?: RangeLike) => document.getText(VSCodeDocumentGetTextSchema.parse(range)) }),
							onDidChangeTextDocument$.pipe(
								filter((event) => event.document == document),
								map((event) => ({ getText: (range?: RangeLike) => event.document.getText(VSCodeDocumentGetTextSchema.parse(range)) }))
							)
						),
						fileSystem,
						fileSystemWatcherFactory,
						onDidChangeTextDocument$
					)
				}),
				switchMap((popfile) => {
					return combineLatest({
						startingCurrency: popfile.startingCurrency$,
						eventPopfile: popfile.eventPopfile$,
						templates: popfile.templates$,
						missions: popfile.missions$,
						waves: popfile.waves$,
					}).pipe(
						withLatestFrom(popfile.document$),
					)
				})
			)
		}).pipe(
			map(({ meta, popfile: [waveSchedule, document] }) => {
				const TANK_PATH = "materials/hud/leaderboard_class_tank.vmt"
				const { startingCurrency, eventPopfile, templates, missions, waves } = waveSchedule

				function attribute(documentSymbols: VDFDocumentSymbol[] | undefined, key: string): boolean {
					if (documentSymbols == undefined) {
						return false
					}

					key = key.toLowerCase()
					const check = (documentSymbol: VDFDocumentSymbol) => documentSymbol.key.toLowerCase() == "Attributes".toLowerCase() && documentSymbol.detail?.toLowerCase() == key

					const value = documentSymbols.some(check)
					if (value) {
						return true
					}

					for (const eventChangeAttributes of documentSymbols.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "EventChangeAttributes".toLowerCase() && documentSymbol.children)) {
						const defaultEvent = eventChangeAttributes.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Default".toLowerCase())?.children
						const value = defaultEvent?.some(check)
						if (value) {
							return true
						}
					}

					const templateName = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
					if (templateName) {
						const template = templates.get(templateName)
						if (template != undefined) {
							const value = attribute(template.documentSymbols, key)
							if (value) {
								return true
							}
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

				return {
					meta,
					startingCurrency: startingCurrency,
					eventPopfile: eventPopfile,
					waves: waves.map((documentSymbol, index): Wave => {

						const missionSpawns = missions
							.values()
							.map((documentSymbol) => {
								const children = documentSymbol.children
								if (!children) {
									return null
								}

								const objective = children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Objective".toLowerCase())
								if (objective?.detail?.toLowerCase() == "DestroySentries".toLowerCase()) {
									return null
								}

								let beginAtWave = parseInt(children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "BeginAtWave".toLowerCase())?.detail ?? "")
								let runForThisManyWaves = parseInt(children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "RunForThisManyWaves".toLowerCase())?.detail ?? "")

								if (!isNaN(beginAtWave)) {
									beginAtWave += -1
									if (beginAtWave > index) {
										return null
									}
									else if (!isNaN(runForThisManyWaves)) {
										if ((beginAtWave + runForThisManyWaves) <= index) {
											return null
										}
									}
								}

								return children.findLast((documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
							})
							.filter((value) => value != null)
							.toArray()

						const waveSpawns = documentSymbol.children!.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children)

						function hashSpawner(documentSymbols: VDFDocumentSymbol[], findLast: (documentSymbol: VDFDocumentSymbol) => boolean): string[] {
							return [
								...documentSymbols.map((documentSymbol) => document.getText(documentSymbol.range)),
								...documentSymbols.flatMap((documentSymbol) => {
									const spawner = documentSymbol.children?.findLast(findLast)
									if (!spawner || !spawner.children) {
										return []
									}

									switch (spawner.key.toLowerCase()) {
										case "TFBot".toLowerCase():
											const templateName = spawner.children.findLast(({ key }) => key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
											return templateName != undefined ? [templates.get(templateName.toLowerCase())?.toString("\n") ?? ""] : []
										case "Squad".toLowerCase():
										case "RandomChoice".toLowerCase():
											return spawner.children
												.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "TFBot".toLowerCase() && documentSymbol.children)
												.flatMap((documentSymbol) => {
													const templateName = documentSymbol.children!.findLast(({ key }) => key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
													return templateName != undefined ? [templates.get(templateName.toLowerCase())?.toString("\n") ?? ""] : []
												})
										case "Tank".toLowerCase():
											return []
										default:
											return []
									}
								})
							]
						}

						const key = JSON.stringify([
							hashSpawner(waveSpawns, (documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase())),
							hashSpawner(missionSpawns, (documentSymbol) => populationSpawnerKeys.includes(documentSymbol.key.toLowerCase())),
						])

						const cached = cache.get(index)?.get(key)
						if (cached) {
							return cached
						}

						let currency = 0

						const icons = {
							normal: <HUDEnemyData[]>[],
							support: <HUDEnemyData[]>[],
						}

						for (const spawner of missionSpawns) {
							addSpawner({
								type: Type.Mission,
								spawner: spawner,
								totalCount: 1
							})
						}

						let expected = 0
						let actual = 0

						function addSpawner({ type, spawner, totalCount }: { type: Type, spawner: VDFDocumentSymbol, totalCount: number }) {
							switch (spawner.key.toLowerCase()) {
								case "TFBot".toLowerCase(): {
									if (totalCount > 0 || type == Type.Support) {
										addIcon({
											type,
											icon: getClassIcon(spawner.children)?.toLowerCase() ?? null,
											count: totalCount,
											miniboss: attribute(spawner.children, "MiniBoss"),
											alwayscrit: attribute(spawner.children, "AlwaysCrit"),
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
													miniboss: attribute(member.children, "MiniBoss"),
													alwayscrit: attribute(member.children, "AlwaysCrit"),
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
														alwayscrit: attribute(member.children, "AlwaysCrit"),
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
													miniboss: attribute(member.children, "MiniBoss"),
													alwayscrit: attribute(member.children, "AlwaysCrit"),
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
														alwayscrit: attribute(member.children, "AlwaysCrit"),
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

						for (const waveSpawn of waveSpawns) {

							const totalCurrency = parseInt(waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCurrency".toLowerCase())?.detail ?? "") || 0
							if (totalCurrency > 0) {
								currency += totalCurrency
							}

							const support = waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Support".toLowerCase())?.detail != undefined
							const totalCount = parseInt(waveSpawn.children!.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCount".toLowerCase())?.detail ?? "") || 0

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

						const wave: Wave = {
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

						let map = cache.get(index)
						if (!map) {
							map = new Map()
							cache.set(index, map)
						}
						map.clear()
						map.set(key, wave)

						return wave
					})
				}
			})
		)

		function vtf(fileSystem: FileSystemMountPoint, path: string) {
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

									const [buf] = await Promise.all([
										await workspace.fs.readFile(uri),
										initVTFPNG(context)
									])

									using vtf = new VTF(buf)
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
						return observableToAsyncIterable<ObservedValueOf<ReturnType<typeof vtf>> | null>(
							combineLatest({
								meta: meta$,
								fileSystem: fileSystem$,
								init: from(initBSP(context))
							}).pipe(
								concatMap(async ({ meta, fileSystem }) => {
									console.warn(meta)

									if (!meta.map) {
										return of(null)
									}

									const uri = await firstValueFrom(fileSystem.resolveFile(`maps/mvm_${meta.map}.bsp`))
									if (uri == null) {
										return of(null)
									}

									const [buf] = await Promise.all([
										workspace.fs.readFile(uri),
										initBSP(context)
									])

									const entities = new BSP(buf).entities()
									const skyname = entities[0]["skyname"]

									// bk
									// ft
									// lf
									// rt
									return vtf(fileSystem, `materials/skybox/${skyname}ft.vmt`)
								}),
								switchAll()
							),
							signal!
						)
					}),
				png: t
					.procedure
					.input(
						z.object({
							path: z.string(),
						})
					)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<ObservedValueOf<ReturnType<typeof vtf>>>(
							fileSystem$.pipe(
								switchMap((fileSystem) => vtf(fileSystem, input.path))
							),
							signal!
						)
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
							fileSystem$.pipe(
								switchMap((fileSystem) => {
									return fileSystem.resolveFile(input.path).pipe(
										concatMap(async (uri) => uri && new Uint8Array(await workspace.fs.readFile(uri)))
									)
								})
							),
							signal!
						)
					}),
				tokens: t.procedure.subscription(({ signal }) => {
					const tokens = (map: Map<string, string>) => ({
						TF_PVE_WaveCount: map.get("TF_PVE_WaveCount".toLowerCase())!,
						TF_MVM_Support: map.get("TF_MVM_Support".toLowerCase())!,
					})

					return observableToAsyncIterable<ReturnType<typeof tokens>>(
						language$.pipe(map(tokens)),
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
