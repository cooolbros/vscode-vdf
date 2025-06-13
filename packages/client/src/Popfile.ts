import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { posix } from "path"
import { firstValueFrom } from "rxjs"
import { VDFRange, VDFSyntaxError } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { workspace } from "vscode"
import { TextDocument } from "vscode-languageserver-textdocument"

export class UriSyntaxError extends Error {
	public readonly cause: VDFSyntaxError
	constructor(public readonly uri: Uri, error: VDFSyntaxError) {
		super(error.message)
		this.cause = error
	}
}

/**
 * @class
 */
export class Popfile {

	private static readonly decoder = new TextDecoder("utf-8")
	public static readonly robot = ["robot_standard.pop", "robot_giant.pop", "robot_gatebot.pop"].map((name) => `scripts/population/${name}`)
	public static readonly waveSpawnKeys = [
		"ClosestPoint",
		"DoneOutput",
		"DoneWarningSound",
		"FirstSpawnOutput",
		"FirstSpawnWarningSound",
		"LastSpawnOutput",
		"LastSpawnWarningSound",
		"MaxActive",
		"Name",
		"RandomSpawn",
		"SpawnCount",
		"StartWaveOutput",
		"StartWaveWarningSound",
		"Support",
		"Template",
		"TotalCount",
		"TotalCurrency",
		"WaitBeforeStarting",
		"WaitBetweenSpawns",
		"WaitBetweenSpawnsAfterDeath",
		"WaitForAllDead",
		"WaitForAllSpawned",
		"Where",
	].map((key) => key.toLowerCase())

	public readonly base: { value: string, range: VDFRange }[]
	public readonly waveSchedule: VDFDocumentSymbols
	public readonly waveScheduleRange: VDFRange
	public readonly templatesBlock?: VDFDocumentSymbol

	constructor(uri: Uri, text: string, private readonly fileSystem: FileSystemMountPoint) {
		const { base, waveSchedule, waveScheduleRange } = this.load(uri, text)

		this.base = base
		this.waveSchedule = waveSchedule
		this.waveScheduleRange = waveScheduleRange

		const templatesBlock = waveSchedule.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())
		if (templatesBlock?.detail) {
			throw new Error(`Templates ${templatesBlock.detail}`)
		}

		this.templatesBlock = templatesBlock
	}

	private async read(path: string) {
		const uri = await firstValueFrom(this.fileSystem.resolveFile(path))
		if (!uri) {
			throw new Error(path)
		}

		const text = Popfile.decoder.decode(await workspace.fs.readFile(uri))
		return this.load(uri, text)
	}

	private load(uri: Uri, text: string) {
		const document = TextDocument.create(uri.toString(), "popfile", 1, text)

		try {
			const documentSymbols = getVDFDocumentSymbols(text, { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) })
			const base = documentSymbols
				.values()
				.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base")
				.filter((documentSymbol) => documentSymbol.detail != undefined)
				.map((documentSymbol) => ({ value: documentSymbol.detail!, range: documentSymbol.range }))
				.toArray()

			const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")
			if (!waveSchedule?.children) {
				throw new Error("WaveSchedule")
			}

			return {
				document,
				base,
				waveSchedule: waveSchedule.children!,
				waveScheduleRange: waveSchedule.childrenRange!
			}
		}
		catch (error) {
			if (error instanceof VDFSyntaxError) {
				throw new UriSyntaxError(uri, error)
			}
			throw error
		}
	}

	public async templates() {
		const templatesBlock = this.waveSchedule.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())
		const templates = new Map(templatesBlock?.children?.map((documentSymbol) => [documentSymbol.key.toLowerCase(), new Template(documentSymbol.key, documentSymbol)]))

		// Merge templates in file with #base templates
		const mergeBaseTemplates = async (path: string) => {
			const { base, waveSchedule } = await this.read(path)

			const templatesDocumentSymbols = waveSchedule
				.values()
				.filter(({ key }) => key.toLowerCase() == "Templates".toLowerCase())
				.map((documentSymbol) => documentSymbol.children)
				.filter(children => children != undefined)
				.flatMap((children) => children)

			for (const template of templatesDocumentSymbols) {
				if (template.children != undefined && template.children.length > 0) {
					const key = template.key.toLowerCase()
					if (!templates.has(key)) {
						templates.set(key, new Template(template.key))
					}
					templates.get(key)!.add(template.children)
				}
			}

			for (const baseFile of base) {
				const basePath = posix.resolve(`/${posix.dirname(path)}/${baseFile.value}`).substring(1)
				await mergeBaseTemplates(basePath)
			}
		}

		for (const baseFile of this.base) {
			const basePath = posix.resolve(`/scripts/population/${baseFile.value}`).substring(1)
			await mergeBaseTemplates(basePath)
		}

		for (const template of templates.values()) {
			template.resolve(templates)
		}

		return templates
	}

	public referencedTemplates() {

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

		const waveSpawns = [
			// https://github.com/cooolbros/vscode-vdf/issues/43
			...this.waveSchedule
				.values()
				.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Mission".toLowerCase())
				.map((documentSymbol) => documentSymbol.children)
				.filter((children) => children != undefined),
			...this.waveSchedule
				.values()
				.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase())
				.flatMap((documentSymbol) => documentSymbol.children ?? [])
				.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase())
				.map((documentSymbol) => documentSymbol.children)
				.filter((children) => children != undefined)
		]

		return new Set(
			waveSpawns
				.flatMap((documentSymbols) => {
					const spawner = documentSymbols.findLast((documentSymbol) => !Popfile.waveSpawnKeys.includes(documentSymbol.key.toLowerCase()))
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
	}
}

export class Template {

	public readonly name: string
	public readonly range?: VDFRange
	public readonly documentSymbols: VDFDocumentSymbol[]
	public readonly keys: Set<string>

	constructor(name: string, documentSymbol?: VDFDocumentSymbol) {
		this.name = name
		this.range = documentSymbol?.range

		this.documentSymbols = []
		if (documentSymbol) {
			if (!documentSymbol.children) {
				throw new Error(name)
			}
			this.documentSymbols.push(...documentSymbol.children)
		}

		this.keys = new Set(documentSymbol?.children?.map(({ key }) => key.toLowerCase()))
	}

	public add(documentSymbols: VDFDocumentSymbol[]) {
		const keyValues = documentSymbols.filter((documentSymbol) => !this.keys.has(documentSymbol.key.toLowerCase()))
		this.documentSymbols.push(...keyValues)
		for (const { key } of keyValues) {
			this.keys.add(key.toLowerCase())
		}
	}

	public resolve(templates: Map<string, Template>) {
		const seen = new Set([this.name])

		const add = (documentSymbols: VDFDocumentSymbol[]) => {

			const referencedTemplate = documentSymbols.find(({ key }) => key.toLowerCase() == "Template".toLowerCase())?.detail
			if (!referencedTemplate) {
				return
			}

			const key = referencedTemplate.toLowerCase()
			if (seen.has(key)) {
				throw new Error(referencedTemplate)
			}
			seen.add(key)

			const template = templates.get(key)
			if (!template) {
				return
			}

			this.add(template.documentSymbols)
		}

		add(this.documentSymbols)

		for (const documentSymbol of this.documentSymbols) {
			if (documentSymbol.key == "Template".toLowerCase()) {
				this.documentSymbols.splice(this.documentSymbols.indexOf(documentSymbol), 1)
			}
		}
	}

	public toString(eol: string) {
		const print = (s: string) => /\s/.test(s) ? `"${s}"` : s
		const toString = (documentSymbols: VDFDocumentSymbol[], i: number): string => {
			return documentSymbols.map((documentSymbol) => `${"\t".repeat(i)}${print(documentSymbol.key)}${documentSymbol.detail ? `\t${print(documentSymbol.detail)}` : `${eol}${"\t".repeat(i)}{${eol}${toString(documentSymbol.children!, i + 1)}${eol}${"\t".repeat(i)}}`}`).join(eol)
		}
		return `${this.name}${eol}{${eol}${toString(this.documentSymbols, 1)}${eol}}`
	}
}
