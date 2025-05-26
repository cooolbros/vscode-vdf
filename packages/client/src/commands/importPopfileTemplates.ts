import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { commands, EndOfLine, Position, Range, window, workspace, WorkspaceEdit, type TextEditor } from "vscode"
import { Popfile, UriSyntaxError } from "../Popfile"

export function importPopfileTemplates(fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>) {
	return async ({ document }: TextEditor) => {
		try {
			await using fileSystem = await fileSystemMountPointFactory.get({ type: "tf2" })

			const popfile = new Popfile(new Uri(document.uri), document.getText(), fileSystem)
			if (!popfile.base.length) {
				window.showWarningMessage("#base")
				return
			}
			if (!popfile.waveSchedule) {
				window.showWarningMessage("WaveSchedule")
				return
			}

			const templates = await popfile.templates()
			const templatesInFile = new Set(templates.entries().filter(([key, template]) => template.range != undefined).map(([key, template]) => key))
			const referencedTemplates = popfile.referencedTemplates()

			const edit = new WorkspaceEdit()
			const eol = document.eol == EndOfLine.CRLF ? "\r\n" : "\n"

			// Append KeyValues to existing referenced Templates
			for (const key of templatesInFile) {
				const template = templates.get(key)!
				const range = template.range!
				edit.replace(
					document.uri,
					new Range(new Position(range.start.line, range.start.character), new Position(range.end.line, range.end.character)),
					template.toString(eol).split(eol).map((line, index) => `${index != 0 ? "\t".repeat(2) : ""}${line}`).join(eol)
				)
			}

			let text = new Set(templates.keys())
				.difference(templatesInFile)
				.intersection(referencedTemplates)
				.keys()
				.map((key) => templates.get(key)!.toString(eol))
				.reduce((a, b, index) => `${a}${index != 0 ? eol.repeat(2) : ""}${b}`, "")
				.split(eol).map((line) => `${line != "" ? "\t".repeat(2) : ""}${line}`).join(eol)

			let insertPosition = popfile.templatesBlock?.children!.at(-1)?.range.end
			if (insertPosition) {
				edit.insert(
					document.uri,
					new Position(insertPosition.line, insertPosition.character),
					`${eol.repeat(2)}${text}`
				)
			}
			else if (popfile.templatesBlock?.childrenRange) {
				edit.insert(
					document.uri,
					new Position(popfile.templatesBlock.childrenRange.start.line, popfile.templatesBlock.childrenRange.start.character),
					`${eol}${text}`
				)
			}
			else {
				text = `${eol}\tTemplates${eol}\t{${eol}${text}${eol}\t}${eol}`

				let position = popfile.waveSchedule.find((documentSymbol, index, obj) =>
					documentSymbol.key.toLowerCase() != "Mission".toLowerCase()
					&& documentSymbol.key.toLowerCase() != "Wave".toLowerCase()
					&& ["Mission".toLowerCase(), "Wave".toLowerCase()].includes(obj[index + 1]?.key.toLowerCase())
				)?.range.end

				if (position) {
					text = `${eol}${text}`
				}
				else {
					position = popfile.waveScheduleRange.start
				}

				edit.insert(
					document.uri,
					new Position(position.line, position.character),
					text
				)
			}

			// Remove #base files
			for (const { value, range } of popfile.base) {
				const basePath = posix.resolve(`/scripts/population/${value}`).substring(1)
				if (!Popfile.robot.includes(basePath)) {
					edit.delete(document.uri, new Range(
						new Position(range.start.line, range.start.character),
						new Position(range.end.line, range.end.character),
					))
				}
			}

			// Remove rest of Templates blocks
			for (const templateBlock of popfile.waveSchedule.values().filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase()).drop(1)) {
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
