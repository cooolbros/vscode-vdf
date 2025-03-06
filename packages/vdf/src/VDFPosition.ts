import { z } from "zod"

export interface IPosition {
	line: number
	character: number
}

export class VDFPosition implements IPosition {

	public static readonly schema = z.object({
		line: z.number(),
		character: z.number(),
	}).transform((arg) => new VDFPosition(arg.line, arg.character))

	public line: number
	public character: number

	constructor(line: number, character: number) {

		this.line = line
		this.character = character
	}

	public isBefore(value: IPosition): boolean {
		if (this.line < value.line) {
			return true
		}
		if (value.line < this.line) {
			return false
		}
		return this.character <= value.character
	}

	public isAfter(value: IPosition): boolean {
		if (this.line < value.line) {
			return false
		}
		if (value.line < this.line) {
			return true
		}
		return this.character >= value.character
	}

	public with({ line = this.line, character = this.character }: { line?: number, character?: number }) {
		return new VDFPosition(line, character)
	}

	public toJSON() {
		return {
			line: this.line,
			character: this.character,
		}
	}
}
