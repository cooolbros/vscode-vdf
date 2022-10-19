import { EndOfStreamError, UnclosedEscapeSequenceError, UnexpectedTokenError } from "./VDFErrors"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"

export class VDFTokeniser {

	/**
	 * ```ts
	 * readonly [" ", "\t", "\r", "\n"]
	 * ```
	 */
	public static readonly whiteSpaceIgnore = new Set([" ", "\t", "\r", "\n"])

	/**
	 * ```ts
	 * readonly ["\"", "{", "}"]
	 * ```
	 */
	public static readonly whiteSpaceTokenTerminate = new Set(["\"", "{", "}"])

	protected readonly str: string

	/**
	 * Zero-based offset position
	 */
	public index = 0

	/**
	 * Zero-based line number
	 */
	public line = 0

	/**
	 * Zero-based character number in current line
	 */
	public character = 0

	// Peek
	protected _peek: { token: string, index: number, line: number, character: number } | null = null

	// EOF
	protected _EOFRead = false

	constructor(str: string) {
		this.str = str
	}

	public next(lookAhead = false): string | null {

		if (this._peek) {
			const token = this._peek.token
			if (!lookAhead) {
				this.index = this._peek.index
				this.line = this._peek.line
				this.character = this._peek.character
				this._peek = null
			}
			return token
		}

		let index = this.index
		let line = this.line
		let character = this.character

		while (index < this.str.length && (VDFTokeniser.whiteSpaceIgnore.has(this.str[index]) || this.str[index] == "/")) {
			if (this.str[index] == "\n") {
				line++
			}
			else if (this.str[index] == "/") {
				const i1 = index + 1
				if (i1 < this.str.length && this.str[i1] == "/") {
					index++
					while (index < this.str.length && this.str[index] != "\n") {
						index++
					}
					line++
					character = 0
				}
				else {
					break
				}
			}
			else {
				character++
			}
			index++
		}

		if (index >= this.str.length) {
			if (this._EOFRead) {
				const position = new VDFPosition(line, character)
				throw new UnexpectedTokenError("EOF", "token", new VDFRange(position, position))
			}
			this._EOFRead = true
			return null
		}

		const start = index
		const tokenStartPosition = new VDFPosition(line, character)

		if (this.str[index] == "\"") {
			index++
			character++
			while (this.str[index] != "\"") {

				if (index >= this.str.length) {
					throw new EndOfStreamError("closing double quote", new VDFRange(tokenStartPosition, new VDFPosition(line, character)))
				}

				if (this.str[index] == "\n") {
					line++
					character = 0
				}
				else if (this.str[index] == "\\") {
					index++
					character++
					if (index >= this.str.length) {
						throw new UnclosedEscapeSequenceError(new VDFRange(tokenStartPosition, new VDFPosition(line, character)))
					}
				}
				else {
					character++
				}
				index++
			}
			index++
			character++
		}
		else {
			while (index < this.str.length && !VDFTokeniser.whiteSpaceIgnore.has(this.str[index])) {

				if (VDFTokeniser.whiteSpaceTokenTerminate.has(this.str[index])) {
					if (start == index) {
						index++
					}
					break
				}
				else if (this.str[index] == "\\") {
					index++
					character++
					if (index >= this.str.length) {
						throw new UnclosedEscapeSequenceError(new VDFRange(tokenStartPosition, new VDFPosition(line, character)))
					}
				}

				index++
				character++
			}
		}

		const end = index

		const token = this.str.slice(start, end)

		if (lookAhead) {
			this._peek = {
				token,
				index,
				line,
				character
			}
		}
		else {
			this.index = index
			this.line = line
			this.character = character
		}

		return token
	}
}
