import { z } from "zod"
import { positionSchema } from "./Position"

export const rangeSchema = z.object({
	start: positionSchema,
	end: positionSchema
})

export type Range = z.infer<typeof rangeSchema>
