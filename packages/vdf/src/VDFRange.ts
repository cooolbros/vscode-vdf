import { z } from "zod"
import { VDFPosition, type PositionLike } from "./VDFPosition"

export interface RangeLike {
	start: PositionLike
	end: PositionLike
}

export class VDFRange implements RangeLike {

	public static readonly schema = z.object({
		start: VDFPosition.schema,
		end: VDFPosition.schema,
	}).transform((arg) => new VDFRange(arg.start, arg.end))

	public readonly start: VDFPosition
	public readonly end: VDFPosition

	constructor(start: VDFPosition, end: VDFPosition = start) {
		this.start = start
		this.end = end
	}

	public contains(value: RangeLike | PositionLike): boolean {
		if ("start" in value) {
			return this.start.isBefore(value.start) && this.end.isAfter(value.end)
		}
		return this.start.isBefore(value) && this.end.isAfter(value)
	}

	public toJSON() {
		return {
			start: this.start.toJSON(),
			end: this.end.toJSON(),
		}
	}
}
