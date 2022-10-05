import { Position, Range } from "vscode-languageserver";
import { VDFPosition } from "./VDFPosition";

export class VDFRange implements Range {

	start: VDFPosition;
	end: VDFPosition;

	constructor(start: VDFPosition, end: VDFPosition) {
		Range.create(start, end)
		this.start = start
		this.end = end
	}

	contains(value: Range | Position): boolean {
		if (Range.is(value)) {
			return this.start.isBefore(value.start) && this.end.isAfter(value.end)
		}
		return this.start.isBefore(value) && this.end.isAfter(value)
	}
}
