import vscode from "vscode"
import { z } from "zod"
import { VSCodeLocationSchema, VSCodePositionSchema, VSCodeUriSchema } from "../VSCodeSchemas"

const showReferencesSchema = z.tuple([
	VSCodeUriSchema,
	VSCodePositionSchema,
	z.array(VSCodeLocationSchema)
])

export async function showReferences(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...params: any[]): Promise<void> {

	const [uri, position, locations] = showReferencesSchema.parse(params)

	// https://code.visualstudio.com/api/references/commands
	// https://github.com/microsoft/vscode/issues/95308#issuecomment-644123877
	await vscode.commands.executeCommand(
		"editor.action.showReferences",
		uri,
		position,
		locations,
		"peek"
	)
}
