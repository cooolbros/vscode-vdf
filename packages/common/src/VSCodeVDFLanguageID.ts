import { z } from "zod"

export const VSCodeVDFLanguageNameSchema = z.object({
	hudanimations: z.literal("HUD Animations"),
	popfile: z.literal("Popfile"),
	vdf: z.literal("VDF"),
	vmt: z.literal("VMT"),
})

export const VSCodeVDFLanguageIDSchema = VSCodeVDFLanguageNameSchema.keyof()

export type VSCodeVDFLanguageID = z.infer<typeof VSCodeVDFLanguageIDSchema>
