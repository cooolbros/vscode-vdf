import { commands, type TextEditor, type TextEditorEdit } from "vscode"
import { z } from "zod"
import { VSCodeLocationSchema, VSCodePositionSchema, VSCodeUriSchema } from "../VSCodeSchemas"

const showReferencesSchema = z.tuple([
	VSCodeUriSchema,
	VSCodePositionSchema,
	VSCodeLocationSchema.array(),
])

export async function showReferences(editor: TextEditor, edit: TextEditorEdit, ...params: any[]): Promise<void> {

	const [uri, position, locations] = showReferencesSchema.parse(params)

	// https://code.visualstudio.com/api/references/commands
	// https://github.com/microsoft/vscode/issues/95308#issuecomment-644123877
	await commands.executeCommand(
		"editor.action.showReferences",
		uri,
		position,
		locations,
		"peek"
	)
}
