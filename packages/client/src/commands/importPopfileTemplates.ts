import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { firstValueFrom } from "rxjs"
import { VDFSyntaxError } from "vdf"
import { getVDFDocumentSymbols, VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { commands, EndOfLine, Position, Range, window, workspace, WorkspaceEdit, type TextEditor } from "vscode"
import { TextDocument } from "vscode-languageserver-textdocument"

const robot = ["robot_standard.pop", "robot_giant.pop", "robot_gatebot.pop"].map((name) => `scripts/population/${name}`)

const waveSpawnKeys = [
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

export function importPopfileTemplates(fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>) {
	return async ({ document }: TextEditor) => {

		class UriSyntaxError extends Error {
			public readonly cause: VDFSyntaxError
			constructor(public readonly uri: Uri, error: VDFSyntaxError) {
				super(error.message)
				this.cause = error
			}
		}

		try {
			await using fileSystem = await fileSystemMountPointFactory.get({ type: "tf2" })
			const decoder = new TextDecoder("utf-8")
			const options = { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) }

			const read = async (path: string) => {
				const uri = await firstValueFrom(fileSystem.resolveFile(path))
				if (!uri) {
					throw new Error(path)
				}

				const text = decoder.decode(await workspace.fs.readFile(uri))
				return load(uri, text)
			}

			const load = (uri: Uri, text: string) => {
				const document = TextDocument.create(uri.toString(), "popfile", 1, text)

				try {
					const documentSymbols = getVDFDocumentSymbols(text, options)
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

			const { base, waveSchedule, waveScheduleRange } = load(new Uri(document.uri), document.getText())
			if (!base.length) {
				window.showWarningMessage("#base")
				return
			}
			if (!waveSchedule) {
				window.showWarningMessage("WaveSchedule")
				return
			}

			const waveSpawns = [
				// https://github.com/cooolbros/vscode-vdf/issues/43
				...waveSchedule
					.values()
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Mission".toLowerCase())
					.map((documentSymbol) => documentSymbol.children)
					.filter((children) => children != undefined),
				...waveSchedule
					.values()
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase())
					.flatMap((documentSymbol) => documentSymbol.children ?? [])
					.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase())
					.map((documentSymbol) => documentSymbol.children)
					.filter((children) => children != undefined)
			]

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

			const referencedTemplates = new Set(
				waveSpawns
					.flatMap((documentSymbols) => {
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

			const edit = new WorkspaceEdit()
			const eol = document.eol == EndOfLine.CRLF ? "\r\n" : "\n"

			class Template {
				public readonly name: string
				private readonly keys: Set<string>
				private readonly lines: string[]
				constructor(name: string, template?: { documentSymbol: VDFDocumentSymbol, getText: (range: Range) => string }) {
					this.name = name
					if (template?.documentSymbol.detail) {
						throw new Error(template.documentSymbol.key)
					}
					this.keys = new Set(template?.documentSymbol.children!.map(({ key }) => key.toLowerCase()))
					this.lines = template?.documentSymbol.children?.map((documentSymbol) => template.getText(new Range(
						new Position(documentSymbol.range.start.line, documentSymbol.range.start.character),
						new Position(documentSymbol.range.end.line, documentSymbol.range.end.character),
					))) ?? []
				}

				public add(documentSymbols: VDFDocumentSymbols, source: string, getText: (range: Range) => string) {
					const keyValues = documentSymbols.filter((documentSymbol) => !this.keys.has(documentSymbol.key.toLowerCase()))
					const lines: string[] = []

					for (const documentSymbol of keyValues) {
						const text = getText(
							new Range(
								new Position(documentSymbol.range.start.line, documentSymbol.range.start.character),
								new Position(documentSymbol.range.end.line, documentSymbol.range.end.character)
							)
						)

						lines.push(text)
					}

					for (const { key } of keyValues) {
						this.keys.add(key.toLowerCase())
					}

					this.lines.push(...lines)
					return lines
				}

				public toString(i: number) {
					return this.lines.map((line) => `${"\t".repeat(i)}${line}`).join(eol)
				}
			}

			// Merge templates in file with #base templates
			const templatesBlock = waveSchedule.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())

			const templateEdits = new Map(templatesBlock?.children?.map((documentSymbol) => {
				const template = new Template(documentSymbol.key, { documentSymbol, getText: (range) => document.getText(range) })
				const position = new Position(
					documentSymbol.childrenRange!.start.line,
					documentSymbol.childrenRange!.start.character
				)
				return [documentSymbol.key.toLowerCase(), {
					add: (documentSymbols: VDFDocumentSymbols, source: string, getText: (range: Range) => string) => {
						const lines = template.add(documentSymbols, source, getText)
						edit.insert(document.uri, position, eol + lines.join(eol))
					}
				}]
			}))

			const referencedTemplatesNotInFile = referencedTemplates.difference(new Set(templateEdits.keys()))
			const ignore = await Promise.all(robot.map(async (path) => (await firstValueFrom(fileSystem.resolveFile(path)))?.toString()))
			const externalTemplates = new Map<string, Template>()

			const mergeBaseTemplates = async (path: string) => {
				const { document, base, waveSchedule } = await read(path)

				// https://github.com/cooolbros/vscode-vdf/issues/69
				if (ignore.includes(document.uri.toString())) {
					return
				}

				const templatesDocumentSymbols = waveSchedule
					.values()
					.filter(({ key }) => key.toLowerCase() == "Templates".toLowerCase())
					.map((documentSymbol) => documentSymbol.children)
					.filter(children => children != undefined)
					.flatMap((children) => children)

				for (const template of templatesDocumentSymbols) {
					if (template.children != undefined && template.children.length > 0) {
						const key = template.key.toLowerCase()
						if (templateEdits.has(key)) {
							templateEdits.get(key)!.add(template.children, path, (range) => document.getText(range))
						}
						else if (referencedTemplatesNotInFile.has(key)) {
							if (!externalTemplates.has(key)) {
								externalTemplates.set(key, new Template(template.key))
							}
							externalTemplates.get(key)!.add(template.children, path, (range) => document.getText(range))
						}
					}
				}

				for (const baseFile of base) {
					const basePath = posix.resolve(`/${posix.dirname(path)}/${baseFile.value}`).substring(1)
					await mergeBaseTemplates(basePath)
				}
			}

			for (const baseFile of base) {
				const basePath = posix.resolve(`/scripts/population/${baseFile.value}`).substring(1)
				await mergeBaseTemplates(basePath)
			}

			let lines = []
			let i = 0

			for (const template of externalTemplates.values()) {
				lines.push(
					template.name,
					"{",
					...template.toString(1).split(eol),
					"}"
				)

				if (i != externalTemplates.size - 1) {
					lines.push("")
				}

				i++
			}

			let insertPosition = templatesBlock?.children?.at(-1)?.range.end
			if (insertPosition) {
				const position = new Position(insertPosition.line, insertPosition.character)
				edit.insert(document.uri, position, eol.repeat(2) + lines.map((line) => `\t\t${line}`).join(eol))
			}
			else {
				if (templatesBlock?.childrenRange) {
					const position = new Position(templatesBlock.childrenRange.start.line, templatesBlock.childrenRange.start.character)
					edit.insert(document.uri, position, eol + lines.map((line) => `\t\t${line}`).join(eol))
				}
				else {
					lines = [
						"Templates",
						"{",
						...lines.map((line) => `\t${line}`),
						"}"
					]

					const position = waveSchedule.find((documentSymbol, index, obj) => {
						if (documentSymbol.key.toLowerCase() == "Mission".toLowerCase() || documentSymbol.key.toLowerCase() == "Wave".toLowerCase()) {
							return false
						}
						return obj[index + 1]?.key.toLowerCase() == "Mission".toLowerCase() || obj[index + 1]?.key.toLowerCase() == "Wave".toLowerCase()
					})?.range.end

					if (position) {
						edit.insert(document.uri, new Position(position.line, position.character), eol.repeat(2) + lines.map((line) => `\t${line}`).join(eol))
					}
					else {
						edit.insert(document.uri, new Position(waveScheduleRange.start.line, waveScheduleRange.start.character), eol + lines.map((line) => `\t${line}`).join(eol) + eol)
					}
				}
			}

			// Remove #base files
			for (const { value, range } of base) {
				const basePath = posix.resolve(`/scripts/population/${value}`).substring(1)
				if (!robot.includes(basePath)) {
					edit.delete(document.uri, new Range(
						new Position(range.start.line, range.start.character),
						new Position(range.end.line, range.end.character),
					))
				}
			}

			// Remove rest of Templates blocks
			for (const templateBlock of waveSchedule.values().filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase()).drop(1)) {
				edit.delete(document.uri, new Range(
					new Position(templateBlock.range.start.line, templateBlock.range.start.character),
					new Position(templateBlock.range.end.line, templateBlock.range.end.character)
				))
			}

			await workspace.applyEdit(edit)
		}
		catch (error) {
			if (error instanceof Error) {
				window.showErrorMessage(error.message)
				if (error instanceof UriSyntaxError) {
					await commands.executeCommand("vscode.open", error.uri)
					await Promise.all([
						commands.executeCommand("revealLine", { lineNumber: error.cause.range.start.line, at: "top" }),
						commands.executeCommand("workbench.action.problems.focus")
					])
				}
			}
		}
	}
}
