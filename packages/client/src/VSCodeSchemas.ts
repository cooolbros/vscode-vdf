import { Location, Position, Range, Uri } from "vscode"
import { z } from "zod"

export const VSCodeUriSchema = z.object({
	scheme: z.string(),
	authority: z.string(),
	path: z.string(),
	query: z.string(),
	fragment: z.string(),
}).transform((arg) => Uri.from(arg))

export const VSCodePositionSchema = z.object({ line: z.number(), character: z.number() }).transform(({ line, character }) => new Position(line, character))

export const VSCodeRangeSchema = z.object({ start: VSCodePositionSchema, end: VSCodePositionSchema }).transform(({ start, end }) => new Range(start, end))

export const VSCodeLocationSchema = z.object({ uri: VSCodeUriSchema, range: VSCodeRangeSchema }).transform((arg) => new Location(arg.uri, arg.range))
