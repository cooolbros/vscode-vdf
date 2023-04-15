import { z } from "zod"

export const positionSchema = z.object({
	line: z.number(),
	character: z.number()
})

export type Position = z.infer<typeof positionSchema>
