import { z } from "zod"

export const VSCodeVDFLanguageIDSchema = z.union([
	z.literal("hudanimations"),
	z.literal("popfile"),
	z.literal("vmt"),
	z.literal("vdf")
])

export type VSCodeVDFLanguageID = z.infer<typeof VSCodeVDFLanguageIDSchema>
