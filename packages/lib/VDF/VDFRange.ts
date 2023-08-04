import { Position, Range } from "vscode-languageserver"
import type { VDFPosition } from "./VDFPosition"

export class VDFRange implements Range {

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
