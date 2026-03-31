import { z } from "zod"

const VDFLanguageConfigurationSchema = ({ insertNewlineBeforeObjects, quotes, tabs }: { insertNewlineBeforeObjects: boolean, quotes: boolean, tabs: number }) => z.object({
	format: z.object({
		insertNewlineBeforeObjects: z.boolean().default(insertNewlineBeforeObjects),
		quotes: z.boolean().default(quotes),
		tabs: z.number().min(-1).default(tabs),
	}).default(<any>{}),
	suggest: z.object({
		enable: z.boolean().default(true)
	}).default(<any>{})
})

export const VSCodeVDFConfigurationSchema = z.object({
	filesAutoCompletionKind: z.enum(["incremental", "all"]).default("incremental"),
	updateDiagnosticsEvent: z.enum(["type", "save"]).default("type"),
	hudanimations: z.object({
		format: z.object({
			insertNewlineAfterEvents: z.boolean().default(true),
			layoutScope: z.enum(["event", "file"]).default("event"),
			tabs: z.number().min(1).default(1)
		}).default(<any>{}),
		suggest: z.object({
			enable: z.boolean().default(true)
		}).default(<any>{})
	}).default(<any>{}),
	popfile: VDFLanguageConfigurationSchema({ insertNewlineBeforeObjects: true, quotes: false, tabs: 0 }).extend({
		diagnostics: z.object({
			strict: z.boolean().default(true)
		}).default(<any>{}),
		waveStatusPreview: z.object({
			background: z.object({
				colour: z.string().default("rgb(31, 31, 31)"),
				sky: z.boolean().default(true),
			}).default(<any>{}),
			banner: z.object({
				enable: z.boolean().default(true)
			}).default(<any>{}),
			font: z.object({
				bold: z.string().default("TF2 Build"),
				regular: z.string().default("TF2 Secondary"),
			}).default(<any>{}),
			language: z.enum([
				"english",
				"german",
				"french",
				"italian",
				"korean",
				"spanish",
				"simplified_chinese",
				"traditional_chinese",
				"russian",
				"thai",
				"japanese",
				"portuguese",
				"polish",
				"danish",
				"dutch",
				"finnish",
				"norwegian",
				"swedish",
				"hungarian",
				"czech",
				"romanian",
				"turkish",
				"brazilian",
				"bulgarian",
				"greek",
				"ukrainian",
				"latam_spanish"
			]).default("english"),
			panel: z.object({
				enable: z.boolean().default(true)
			}).default(<any>{})
		}).default(<any>{})
	}),
	vmt: VDFLanguageConfigurationSchema({ insertNewlineBeforeObjects: false, quotes: true, tabs: 1 }).default(<any>{}),
	vdf: VDFLanguageConfigurationSchema({ insertNewlineBeforeObjects: false, quotes: true, tabs: 1 }).default(<any>{}),
})

export type VSCodeVDFConfiguration = z.infer<typeof VSCodeVDFConfigurationSchema>
