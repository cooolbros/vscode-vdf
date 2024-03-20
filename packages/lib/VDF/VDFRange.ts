import { Position, Range } from "vscode-languageserver"
import { z } from "zod"
import { VDFPosition } from "./VDFPosition"

export class VDFRange implements Range {

	public static readonly schema = z.object({
		start: VDFPosition.schema,
		end: VDFPosition.schema,
	}).transform((arg) => new VDFRange(arg.start, arg.end))

	public start: VDFPosition
	public end: VDFPosition

	constructor(start: VDFPosition, end: VDFPosition = start) {
		Range.create(start.line, start.character, end.line, end.character)
		this.start = start
		this.end = end
	}

	public contains(value: Range | Position): boolean {
		if (Range.is(value)) {
			return this.start.isBefore(value.start) && this.end.isAfter(value.end)
		}
		return this.start.isBefore(value) && this.end.isAfter(value)
	}
}
