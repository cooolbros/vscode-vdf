import { Position } from "vscode-languageserver"
import { z } from "zod"

export class VDFPosition implements Position {

	public static readonly schema = z.object({
		line: z.number(),
		character: z.number(),
	}).transform((arg) => new VDFPosition(arg.line, arg.character))

	public line: number
	public character: number

	constructor(line: number, character: number) {
		Position.create(line, character)
		this.line = line
		this.character = character
	}

	public isBefore(value: Position): boolean {
		if (this.line < value.line) {
			return true
		}
		if (value.line < this.line) {
			return false
		}
		return this.character <= value.character
	}

	public isAfter(value: Position): boolean {
		if (this.line < value.line) {
			return false
		}
		if (value.line < this.line) {
			return true
		}
		return this.character >= value.character
	}
}
