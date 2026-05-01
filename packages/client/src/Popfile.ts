import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { BaseResultType, combineLatestBaseFiles, fs, type Stack } from "common/operators/combineLatestBaseFiles"
import { usingAsync } from "common/operators/usingAsync"
import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import { Uri } from "common/Uri"
import { combineLatest, concat, defer, distinctUntilChanged, filter, from, map, Observable, shareReplay, switchAll, withLatestFrom } from "rxjs"
import { VDFSyntaxError, type RangeLike } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { quote } from "vdf-format"
import { commands, workspace, type TextDocumentChangeEvent } from "vscode"
import { TextDocument } from "vscode-languageserver-textdocument"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { VSCodeDocumentGetTextSchema } from "./VSCodeSchemas"

export interface VSCodeDocumentLike {
	getText(range?: RangeLike): string
}

export class UriSyntaxError extends Error {
	public readonly cause: VDFSyntaxError
	constructor(public readonly uri: Uri, error: VDFSyntaxError) {
		super(error.message)
		this.cause = error
	}
}

export interface TemplateBuilder {
	name: string
	uri: Uri
	documentSymbols: VDFDocumentSymbol[]
}

const multiple = new Set([
	"Attributes",
	"Item",
	"ItemAttributes", // distinct by ItemName
	"Tag",
	"TeleportWhere",
])

const ArrayLowKeyIncludes = (array: VDFDocumentSymbol[], key: string) => {
	return array.some((documentSymbol) => documentSymbol.key.toLowerCase() == key)
}

const TFBotMerge = (array: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbol[]) => {
	array.push(...documentSymbols.filter((documentSymbol) => {
		const key = documentSymbol.key.toLowerCase()
		return multiple.has(key) || !ArrayLowKeyIncludes(array, key)
	}))
}

const BaseMerge = (array: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbol[]) => {
	array.push(...documentSymbols.filter((documentSymbol) => !ArrayLowKeyIncludes(array, documentSymbol.key.toLowerCase())))
}

export abstract class PopfileBase implements AsyncDisposable {

	public static readonly robot = new Set([
		"scripts/population/robot_standard.pop",
		"scripts/population/robot_giant.pop",
		"scripts/population/robot_gatebot.pop",
	])

	public readonly uri: Uri
	public readonly document$: Observable<VSCodeDocumentLike>
	private readonly fileSystem: FileSystemMountPoint
	private readonly fileSystemWatcherFactory: FileSystemWatcherFactory
	private readonly onDidChangeTextDocument$: Observable<TextDocumentChangeEvent>

	public readonly documentSymbols$: Observable<VDFDocumentSymbols>
	public readonly base$: Observable<string[]>
	public readonly waveSchedule$: Observable<{ documentSymbol: VDFDocumentSymbol, waveSchedule: Map<string, VDFDocumentSymbol[]> }>
	public readonly startingCurrency$: Observable<number>
	public readonly eventPopfile$: Observable<"Halloween" | null>

	public readonly templatesBlocks$: Observable<VDFDocumentSymbol[]>
	public readonly templates$: Observable<Map<string, Template>>
	public readonly missions$: Observable<VDFDocumentSymbol[]>
	public readonly waves$: Observable<VDFDocumentSymbol[]>

	public readonly referencedTemplates$: Observable<Set<string>>
	public readonly classIcons$: Observable<string[]>

	constructor(uri: Uri, document$: Observable<VSCodeDocumentLike>, fileSystem: FileSystemMountPoint, fileSystemWatcherFactory: FileSystemWatcherFactory, onDidChangeTextDocument$: Observable<TextDocumentChangeEvent>) {

		this.uri = uri
		this.document$ = document$.pipe(shareReplay(1))
		this.fileSystem = fileSystem
		this.fileSystemWatcherFactory = fileSystemWatcherFactory
		this.onDidChangeTextDocument$ = onDidChangeTextDocument$

		this.documentSymbols$ = this.document$.pipe(
			map((document, index) => {
				try {
					return getVDFDocumentSymbols(document.getText(), { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) })
				}
				catch (error) {
					if (error instanceof UriSyntaxError) {
						if (index == 0) {
							Promise.allSettled([Promise.try(async () => {
								await commands.executeCommand("vscode.open", error.uri)
								await Promise.all([
									commands.executeCommand("revealLine", { lineNumber: error.cause.range.start.line, at: "top" }),
									commands.executeCommand("workbench.action.problems.focus")
								])
							})])
						}

						return null
					}
					else {
						console.error(error)
						return null
					}
				}
			}),
			filter((value) => value != null),
			shareReplay({ bufferSize: 1, refCount: true }),
		)

		this.base$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols
					.values()
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
					.map((documentSymbol) => documentSymbol.detail!.replaceAll(/[/\\]+/g, "/"))
					.toArray()
			}),
			distinctUntilChanged((previous, current) => previous.length == current.length && previous.every((detail, index) => detail == current[index])),
			shareReplay(1)
		)

		this.waveSchedule$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				const documentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")
				if (!documentSymbol?.children) {
					throw new Error("WaveSchedule")
				}

				return {
					documentSymbol: documentSymbol,
					waveSchedule: Map.groupBy(documentSymbol.children, (documentSymbol) => documentSymbol.key.toLowerCase())
				}
			}),
			shareReplay(1)
		)

		this.startingCurrency$ = this.waveSchedule$.pipe(
			map(({ waveSchedule }) => parseInt(waveSchedule.get("StartingCurrency".toLowerCase())?.at(-1)?.detail ?? "") || 0),
			distinctUntilChanged(),
		)

		this.eventPopfile$ = this.waveSchedule$.pipe(
			map(({ waveSchedule }) => waveSchedule.get("EventPopfile".toLowerCase())?.at(-1)?.detail?.toLowerCase() == "Halloween".toLowerCase() ? <const>"Halloween" : null),
			distinctUntilChanged(),
		)

		const blocks = (key: string) => this.waveSchedule$.pipe(
			map(({ waveSchedule }) => waveSchedule.get(key) ?? []),
			withLatestFrom(this.document$),
			map(([blocks, document]) => {
				return {
					value: blocks,
					text: blocks.map((block) => document.getText(block.range))
				}
			}),
			distinctUntilChanged((previous, current) => previous.value.length == current.value.length && previous.text.every((text, index) => text == current.text[index])),
			map((value) => value.value)
		)

		this.templatesBlocks$ = blocks("Templates".toLowerCase())
		this.missions$ = blocks("Mission".toLowerCase())
		this.waves$ = blocks("Wave".toLowerCase())

		this.templates$ = defer(() => this.getTemplates([])).pipe(
			map((value) => new Map(value.entries().map(([key, builder]) => [key, new Template(builder, value)])))
		)

		const spawns$ = combineLatest({ missions: this.missions$, waves: this.waves$ }).pipe(
			map(({ missions, waves }) => {
				return [
					// https://github.com/cooolbros/vscode-vdf/issues/43
					...missions
						.values()
						.map((documentSymbol) => documentSymbol.children)
						.filter((children) => children != undefined),
					...waves
						.values()
						.flatMap((documentSymbol) => documentSymbol.children ?? [])
						.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase())
						.map((documentSymbol) => documentSymbol.children)
						.filter((children) => children != undefined)
				]
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.referencedTemplates$ = spawns$.pipe(
			map((spawns) => {
				const collect = (squad: VDFDocumentSymbols): string[] => squad.flatMap((documentSymbol) => {
					switch (documentSymbol.key.toLowerCase()) {
						case "TFBot".toLowerCase(): {
							const template = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
							return template ? [template] : []
						}
						case "Squad".toLowerCase():
						case "RandomChoice".toLowerCase(): {
							return documentSymbol.children != undefined
								? collect(documentSymbol.children)
								: []
						}
						default:
							return []
					}
				})

				return new Set(
					spawns.flatMap((documentSymbols) => {
						const spawner = documentSymbols.findLast((documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
						if (!spawner) {
							return []
						}

						switch (spawner.key.toLowerCase()) {
							case "TFBot".toLowerCase(): {
								const template = spawner.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
								return template ? [template] : []
							}
							case "Squad".toLowerCase():
							case "RandomChoice".toLowerCase(): {
								return spawner.children != undefined
									? collect(spawner.children)
									: []
							}
							default:
								return []
						}
					})
				)
			})
		)

		this.classIcons$ = combineLatest({ templates: this.templates$, spawns: spawns$ }).pipe(
			map(({ templates, spawns }) => {
				const collect = (squad: VDFDocumentSymbols): string[] => {
					return squad.flatMap((documentSymbol) => {
						switch (documentSymbol.key.toLowerCase()) {
							case "TFBot".toLowerCase(): {
								const classIcon = documentSymbol.children?.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "ClassIcon".toLowerCase())?.detail?.toLowerCase()
								if (classIcon) {
									return [classIcon]
								}

								const templateReference = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail?.toLowerCase()
								if (templateReference) {
									const template = templates.get(templateReference)
									if (template) {
										const classIcon = template.documentSymbols.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "ClassIcon".toLowerCase())?.detail?.toLowerCase()
										if (classIcon) {
											return [classIcon]
										}
									}
								}

								return []
							}
							case "Squad".toLowerCase():
							case "RandomChoice".toLowerCase(): {
								return documentSymbol.children != undefined
									? collect(documentSymbol.children)
									: []
							}
							default:
								return []
						}
					})
				}

				return new Set(
					spawns
						.flatMap((documentSymbols) => {
							const spawner = documentSymbols.findLast((documentSymbol) => !waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
							if (!spawner) {
								return []
							}

							switch (spawner.key.toLowerCase()) {
								case "TFBot".toLowerCase(): {
									const classIcon = spawner.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "ClassIcon".toLowerCase())?.detail?.toLowerCase()
									return classIcon ? [classIcon] : []
								}
								case "Squad".toLowerCase():
								case "RandomChoice".toLowerCase(): {
									return spawner.children != undefined
										? collect(spawner.children)
										: []
								}
								default:
									return []
							}
						})
				)
			}),
			map((set) => {
				return [...set].toSorted()
			})
		)
	}

	protected getTemplates(stack: Stack): Observable<Map<string, TemplateBuilder>> {
		return combineLatest({ base: this.base$, value: this.templatesBlocks$ }).pipe(
			combineLatestBaseFiles({
				stack: stack,
				open: fs({
					current: this.uri,
					documentSelector: async (uri) => new BasePopfile(
						uri,
						concat(
							from(workspace.fs.readFile(uri)).pipe(
								map((buf) => new TextDecoder("utf-8").decode(buf)),
								map((text) => {
									const document = TextDocument.create(uri.toString(), "popfile", 1, text)
									return { getText: (range?: RangeLike) => document.getText(range) }
								})
							),
							this.onDidChangeTextDocument$.pipe(
								filter((event) => Uri.equals(new Uri(event.document.uri), uri)),
								map((event) => {
									return { getText: (range?: RangeLike) => event.document.getText(VSCodeDocumentGetTextSchema.parse(range)) }
								})
							)
						),
						this.fileSystem,
						this.fileSystemWatcherFactory,
						this.onDidChangeTextDocument$,
					),
					observableSelector: (popfile) => popfile.getTemplates([...stack, { path: `scripts/population/${this.uri.basename()}`, uri: this.uri }]),
					fileSystem: this.fileSystem,
					watch: (uri) => usingAsync(async () => this.fileSystemWatcherFactory.get(uri)).pipe(switchAll()),
					relativeFolderPath: "scripts/population",
				}),

			}),
			map(({ base: results, value }) => {
				const map = this.getTemplatesMap(value)

				for (const baseMap of results.values().filter((result) => result.type == BaseResultType.Success)) {
					for (const [key, base] of baseMap.value) {
						let builder = map.get(key)
						if (!builder) {
							builder = { name: base.name, uri: base.uri, documentSymbols: [] }
							map.set(key, builder)
						}

						BaseMerge(builder.documentSymbols, base.documentSymbols)
					}
				}

				return map
			})
		)
	}

	protected abstract getTemplatesMap(templatesBlocks: VDFDocumentSymbol[]): Map<string, TemplateBuilder>

	public async [Symbol.asyncDispose](): Promise<void> {
	}
}

export class MissionPopfile extends PopfileBase {
	protected getTemplatesMap(templatesBlocks: VDFDocumentSymbol[]): Map<string, TemplateBuilder> {
		const map = new Map<string, TemplateBuilder>()

		const templatesBlock = templatesBlocks[0]
		if (templatesBlock != undefined) {
			const seen = new Set<string>()
			for (const template of templatesBlock?.children ?? []) {
				const key = template.key.toLowerCase()
				if (seen.has(key)) {
					continue
				}
				seen.add(key)

				if (template.children != undefined && template.children.length > 0) {
					map.set(key, { name: template.key, uri: this.uri, documentSymbols: [...template.children] })
				}
			}
		}

		return map
	}
}

export class BasePopfile extends PopfileBase {
	protected getTemplatesMap(templatesBlocks: VDFDocumentSymbol[]): Map<string, TemplateBuilder> {
		const map = new Map<string, TemplateBuilder>()

		for (const templatesBlock of templatesBlocks) {
			const seen = new Set<string>()
			for (const template of templatesBlock?.children ?? []) {
				const key = template.key.toLowerCase()
				if (seen.has(key)) {
					continue
				}
				seen.add(key)

				if (template.children != undefined && template.children.length > 0) {
					let builder = map.get(key)
					if (!builder) {
						builder = { name: template.key, uri: this.uri, documentSymbols: [] }
						map.set(key, builder)
					}

					BaseMerge(builder.documentSymbols, template.children)
				}
			}
		}

		return map
	}
}

export class Template {

	public readonly name: string
	public readonly uri: Uri
	public readonly documentSymbols: VDFDocumentSymbol[]

	constructor(builder: TemplateBuilder, templates: Map<string, TemplateBuilder>) {
		this.name = builder.name
		this.uri = builder.uri

		const documentSymbols = [...builder.documentSymbols]

		const seen = new Set([this.name.toLowerCase()])
		const collectTemplateKeys = (documentSymbols: VDFDocumentSymbol[]): VDFDocumentSymbol[] => {
			const referencedTemplate = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())?.detail
			if (!referencedTemplate) {
				return []
			}

			const key = referencedTemplate.toLowerCase()
			if (seen.has(key)) {
				throw new Error(referencedTemplate)
			}
			seen.add(key)

			const template = templates.get(key)
			if (!template) {
				return []
			}

			const result: VDFDocumentSymbol[] = []
			TFBotMerge(result, template.documentSymbols)
			TFBotMerge(result, collectTemplateKeys(template.documentSymbols))
			return result
		}

		documentSymbols.push(...collectTemplateKeys(documentSymbols))
		this.documentSymbols = documentSymbols.filter((documentSymbol) => documentSymbol.key.toLowerCase() != "Template".toLowerCase())
	}

	public toString(eol: string) {
		const print = (s: string) => quote(s) ? `"${s}"` : s
		const toString = (documentSymbols: VDFDocumentSymbol[], i: number): string => {
			return documentSymbols.map((documentSymbol) => `${"\t".repeat(i)}${print(documentSymbol.key)}${documentSymbol.detail ? `\t${print(documentSymbol.detail)}` : `${eol}${"\t".repeat(i)}{${eol}${toString(documentSymbol.children!, i + 1)}${eol}${"\t".repeat(i)}}`}`).join(eol)
		}
		return `${this.name}${eol}{${eol}${toString(this.documentSymbols, 1)}${eol}}`
	}
}
