import { z } from "zod"
import { Uri } from "./Uri"

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
	teamFortress2Folder: z.string().transform((arg) => {
		// Convert Windows drive letter to lower case to be consistent with VSCode Uris
		const path = arg.trim().replace(/[a-z]{1}:/i, (substring) => substring.toLowerCase()).replaceAll('\\', '/')
		return new Uri({
			scheme: "file",
			authority: "",
			path: path,
			query: "",
			fragment: ""
		})
	}),
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
	popfile: VDFLanguageConfigurationSchema,
	vmt: VDFLanguageConfigurationSchema,
	vdf: VDFLanguageConfigurationSchema,
})

export type VSCodeVDFConfiguration = z.infer<typeof VSCodeVDFConfigurationSchema>
