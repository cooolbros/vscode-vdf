import { z } from "zod"

export const documentLinkDataSchema = z.object({
	range: z.object({
		start: z.object({ line: z.number(), character: z.number() }),
		end: z.object({ line: z.number(), character: z.number() }),
	}),
	target: z.string().optional(),
	data: z.object({
		uri: z.string(),
		key: z.string(),
		value: z.string(),
		index: z.number().optional(),
		link: z.string().optional()
	})
})

export type DocumentLinkData = z.infer<typeof documentLinkDataSchema>
