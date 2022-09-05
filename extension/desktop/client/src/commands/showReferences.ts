import { commands, Location, Position, Range, TextEditor, TextEditorEdit, Uri } from "vscode"

export async function showReferences(editor: TextEditor, edit: TextEditorEdit, ...params: any[]): Promise<void> {

	type JSONLocation = { uri: string, range: JSONRange }
	type JSONRange = { start: JSONPosition, end: JSONPosition }
	type JSONPosition = { line: number, character: number }

	// https://code.visualstudio.com/api/references/commands
	// https://github.com/microsoft/vscode/issues/95308#issuecomment-644123877
	await commands.executeCommand(
		"editor.action.showReferences",
		Uri.parse(<string>params[0]),
		new Position((<JSONRange>params[1]).start.line, (<JSONRange>params[1]).start.character),
		(<JSONLocation[]>params[2]).map(i => new Location(Uri.parse(i.uri), new Range(new Position(i.range.start.line, i.range.start.character), new Position(i.range.end.line, i.range.end.character)))),
		"peek"
	)
}
