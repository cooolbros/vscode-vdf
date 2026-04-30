import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { EMPTY, firstValueFrom, of } from "rxjs"
import type { RangeLike } from "vdf"
import { EndOfLine, type TextEditor, window, workspace, WorkspaceEdit } from "vscode"
import type { FileSystemWatcherFactory } from "../FileSystemWatcherFactory"
import { MissionPopfile } from "../Popfile"
import { VSCodeDocumentGetTextSchema } from "../VSCodeSchemas"

class Table {

	private readonly columns: number
	private header: string[]
	private rows: string[][]

	constructor(columns: number) {
		this.columns = columns
		this.header = []
		this.rows = []
	}

	setHeader(data: string[]): void {
		if (data.length != this.columns) {
			throw new RangeError()
		}
		this.header = data
	}

	addRow(data: string[]): void {
		if (data.length != this.columns) {
			throw new RangeError()
		}
		this.rows.push(data)
	}

	getText(eol: string): string {
		const max = [...this.header, ...this.rows].flat().reduce((total, current) => Math.max(total, current.length), 0)
		const hr = `+${new Array({ length: this.columns }).fill("-".repeat(max + 2)).join("+")}+`
		return [
			``,
			hr,
			`|${this.header.map((header) => ` ${header}${" ".repeat(max - header.toString().length)} `).join("|")}|`,
			hr,
			...this.rows.map((row) => `|${row.map((column) => ` ${column}${" ".repeat(max - column.toString().length)} `).join("|")}|`),
			hr,
			``,
		].map((line) => `// ${line}`.trim()).join(eol)
	}
}

export function listPopfileClassIcons(fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>, fileSystemWatcherFactory: FileSystemWatcherFactory) {
	return async ({ document, selection }: TextEditor) => {
		if (document.languageId != "popfile") {
			window.showWarningMessage(document.languageId)
			return
		}

		await using fileSystem = await fileSystemMountPointFactory.get({ type: "tf2" })
		const popfile = new MissionPopfile(
			new Uri(document.uri),
			of({ getText: (range?: RangeLike) => document.getText(VSCodeDocumentGetTextSchema.parse(range)) }),
			fileSystem,
			fileSystemWatcherFactory,
			EMPTY
		)

		const icons = await firstValueFrom(popfile.classIcons$)

		const table = new Table(1)
		table.setHeader(["Icons"])
		for (const icon of icons) {
			table.addRow([icon])
		}

		const edit = new WorkspaceEdit()
		const text = table.getText(document.eol == EndOfLine.CRLF ? "\r\n" : "\n")
		edit.insert(document.uri, selection.start, text)
		await workspace.applyEdit(edit)
	}
}
