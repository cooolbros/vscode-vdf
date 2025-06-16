import { z } from "zod"

const VDFLanguageConfigurationSchema = z.object({
	format: z.object({
		insertNewlineBeforeObjects: z.boolean(),
		quotes: z.boolean(),
		tabs: z.number().min(-1),
	}),
	suggest: z.object({
		enable: z.boolean()
	})
})

export const VSCodeVDFConfigurationSchema = z.object({
	filesAutoCompletionKind: z.enum(["incremental", "all"]),
	updateDiagnosticsEvent: z.enum(["type", "save"]),
	hudanimations: z.object({
		format: z.object({
			insertNewlineAfterEvents: z.boolean(),
			layoutScope: z.enum(["event", "file"]),
			tabs: z.number().min(1)
		}),
		suggest: z.object({
			enable: z.boolean()
		})
	}),
	popfile: VDFLanguageConfigurationSchema.merge(z.object({
		waveStatusPreview: z.object({
			background: z.object({
				colour: z.string(),
				sky: z.boolean(),
			}),
			font: z.object({
				bold: z.string(),
				regular: z.string(),
			}),
			panel: z.object({
				enable: z.boolean()
			})
		})
	})),
	vmt: VDFLanguageConfigurationSchema,
	vdf: VDFLanguageConfigurationSchema,
})

export type VSCodeVDFConfiguration = z.infer<typeof VSCodeVDFConfigurationSchema>
