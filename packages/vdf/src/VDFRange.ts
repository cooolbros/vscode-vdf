import { z } from "zod"
import { VDFPosition } from "./VDFPosition"

export class VDFRange {

	public static readonly schema = z.object({
		start: VDFPosition.schema,
		end: VDFPosition.schema,
	}).transform((arg) => new VDFRange(arg.start, arg.end))

	public start: VDFPosition
	public end: VDFPosition

	constructor(start: VDFPosition, end: VDFPosition = start) {
		this.start = start
		this.end = end
	}

	public contains(value: VDFRange | VDFPosition): boolean {
		if ("start" in value) {
			return this.start.isBefore(value.start) && this.end.isAfter(value.end)
		}
		return this.start.isBefore(value) && this.end.isAfter(value)
	}
}
