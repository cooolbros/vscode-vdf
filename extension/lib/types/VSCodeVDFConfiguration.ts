import { z } from "zod"

const VDFFormatConfigurationSchema = z.object({
	format: z.object({
		insertNewlineBeforeObjects: z.boolean(),
		quotes: z.boolean(),
		tabs: z.number().min(-1),
	})
})

export const VSCodeVDFConfigurationSchema = z.object({
	filesAutoCompletionKind: z.enum(["incremental", "all"]),
	teamFortress2Folder: z.string(),
	updateDiagnosticsEvent: z.enum(["type", "save"]),
	hudanimations: z.object({
		format: z.object({
			insertNewlineAfterEvents: z.boolean(),
			layoutScope: z.enum(["event", "file"]),
			tabs: z.number().min(1)
		}),
	}),
	popfile: VDFFormatConfigurationSchema,
	vmt: VDFFormatConfigurationSchema,
	vdf: VDFFormatConfigurationSchema,
})

export type VSCodeVDFConfiguration = z.infer<typeof VSCodeVDFConfigurationSchema>
