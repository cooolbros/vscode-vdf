import vscode from "vscode"
import { z } from "zod"

export const VSCodeUriSchema = z.object({
	scheme: z.string(),
	authority: z.string(),
	path: z.string(),
	query: z.string(),
	fragment: z.string(),
}).transform((arg) => vscode.Uri.from(arg))

export const VSCodePositionSchema = z.object({ line: z.number(), character: z.number() }).transform(({ line, character }) => new vscode.Position(line, character))

export const VSCodeRangeSchema = z.object({ start: VSCodePositionSchema, end: VSCodePositionSchema }).transform(({ start, end }) => new vscode.Range(start, end))

export const VSCodeLocationSchema = z.object({ uri: VSCodeUriSchema, range: VSCodeRangeSchema }).transform((arg) => new vscode.Location(arg.uri, arg.range))

export const VSCodeDocumentGetTextSchema = VSCodeRangeSchema.optional()
