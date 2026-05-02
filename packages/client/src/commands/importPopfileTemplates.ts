import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { combineLatest, EMPTY, firstValueFrom, map, of } from "rxjs"
import type { RangeLike } from "vdf"
import { commands, EndOfLine, Position, window, workspace, WorkspaceEdit, type TextEditor } from "vscode"
import type { FileSystemWatcherFactory } from "../FileSystemWatcherFactory"
import { MissionPopfile, PopfileBase, UriSyntaxError } from "../Popfile"
import { VSCodeDocumentGetTextSchema, VSCodePositionSchema, VSCodeRangeSchema } from "../VSCodeSchemas"

export function importPopfileTemplates(fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>, fileSystemWatcherFactory: FileSystemWatcherFactory) {
	return async ({ document }: TextEditor) => {
		try {
			await using fileSystem = await fileSystemMountPointFactory.get({ type: "tf2" })
			const popfile = new MissionPopfile(
				new Uri(document.uri),
				of({ getText: (range?: RangeLike) => document.getText(VSCodeDocumentGetTextSchema.parse(range)) }),
				fileSystem,
				fileSystemWatcherFactory,
				EMPTY
			)

			const { robotTemplates, popfile: { documentSymbols, base, waveSchedule, templates, referencedTemplates } } = await firstValueFrom(combineLatest({
				robotTemplates: combineLatest(PopfileBase.robot.values().map((path) => fileSystem.resolveFile(path)).toArray()).pipe(
					map((uris) => new Set(uris.values().filter((uri) => uri != null).map((uri) => uri.toString()).toArray()))
				),
				popfile: combineLatest({
					documentSymbols: popfile.documentSymbols$,
					base: popfile.base$,
					waveSchedule: popfile.waveSchedule$,
					templates: popfile.templates$,
					referencedTemplates: popfile.referencedTemplates$,
				})
			}))

			if (!base.length) {
				window.showWarningMessage("#base")
				return
			}

			if (!waveSchedule.documentSymbol) {
				window.showWarningMessage("WaveSchedule")
				return
			}

			const templatesBlocks = waveSchedule.waveSchedule.get("Templates".toLowerCase()) ?? []
			const templatesBlock = templatesBlocks.at(0)
			const templatesInFile = new Map(templatesBlock?.children?.map((documentSymbol) => [documentSymbol.key.toLowerCase(), documentSymbol]))

			const edit = new WorkspaceEdit()
			const eol = document.eol == EndOfLine.CRLF ? "\r\n" : "\n"

			// Append KeyValues to existing referenced Templates
			for (const [key, documentSymbol] of templatesInFile) {
				const template = templates.get(key)!
				if (documentSymbol.children != undefined && template.documentSymbols.length > documentSymbol.children.length) {
					edit.replace(
						document.uri,
						VSCodeRangeSchema.parse(documentSymbol.range),
						template.toString(eol).split(eol).map((line, index) => `${index != 0 ? "\t".repeat(2) : ""}${line}`).join(eol)
					)
				}
			}

			const templatesToAdd = new Set(templates.keys())
				.difference(templatesInFile)
				.intersection(referencedTemplates)
				.values()
				.map((key) => templates.get(key)!)
				.filter((template) => !robotTemplates.has(template.uri.toString()))
				.toArray()

			if (templatesToAdd.length > 0) {
				let text = templatesToAdd
					.map((template) => template.toString(eol))
					.reduce((a, b, index) => `${a}${index != 0 ? eol.repeat(2) : ""}${b}`, "")
					.split(eol).map((line) => `${line != "" ? "\t".repeat(2) : ""}${line}`).join(eol)

				let insertPosition = templatesBlock?.children!.at(-1)?.range.end
				if (insertPosition) {
					edit.insert(
						document.uri,
						VSCodePositionSchema.parse(insertPosition),
						`${eol.repeat(2)}${text}`
					)
				}
				else if (templatesBlock?.childrenRange) {
					edit.insert(
						document.uri,
						VSCodePositionSchema.parse(templatesBlock.childrenRange),
						`${eol}${text}`
					)
				}
				else {
					text = `${eol}\tTemplates${eol}\t{${eol}${text}${eol}\t}${eol}`

					let position = waveSchedule.documentSymbol.children!.find((documentSymbol, index, obj) =>
						documentSymbol.key.toLowerCase() != "Mission".toLowerCase()
						&& documentSymbol.key.toLowerCase() != "Wave".toLowerCase()
						&& ["Mission".toLowerCase(), "Wave".toLowerCase()].includes(obj[index + 1]?.key.toLowerCase())
					)?.range.end

					if (position) {
						text = `${eol}${text}`
					}
					else {
						position = waveSchedule.documentSymbol.range.start
					}

					edit.insert(
						document.uri,
						new Position(position.line, position.character),
						text
					)
				}
			}

			// Remove #base files
			for (const documentSymbol of documentSymbols.values().filter((documentSymbol) => documentSymbol.key.toLowerCase() == "#base")) {
				if (!documentSymbol.detail || !PopfileBase.robot.has(posix.resolve(`/scripts/population/${documentSymbol.detail}`).substring(1))) {
					edit.delete(document.uri, VSCodeRangeSchema.parse(documentSymbol.range))
				}
			}

			// Remove rest of Templates blocks
			for (const templateBlock of templatesBlocks.values().drop(1)) {
				edit.delete(document.uri, VSCodeRangeSchema.parse(templateBlock.range))
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
