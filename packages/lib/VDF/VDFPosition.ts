import { Position } from "vscode-languageserver"

export class VDFPosition implements Position {

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
