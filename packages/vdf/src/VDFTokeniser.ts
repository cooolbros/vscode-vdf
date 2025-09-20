import { UnclosedEscapeSequenceError, UnexpectedCharacterError, UnexpectedEndOfFileError } from "./VDFErrors"
import { VDFPosition } from "./VDFPosition"
import { VDFRange } from "./VDFRange"
import { VDFTokenType, type VDFToken } from "./VDFToken"

export class VDFTokeniser {

	/**
	 * ```ts
	 * readonly [" ", "\t", "\r"]
	 * ```
	 */
	private static readonly whiteSpaceIgnore = new Set([" ", "\t", "\r"])

	/**
	 * ```ts
	 * readonly ["\"", "{", "}"]
	 * ```
	 */
	private static readonly whiteSpaceTokenTerminate = new Set(["\"", "{", "}"])

	private readonly str: string

	/**
	 * Whether to allow multiline strings, only respected when token is double quoted string
	 */
	public allowMultilineString: boolean = false

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

	private peeked: { token: VDFToken | null, index: number, line: number, character: number } | null = null
	private _EOFRead: boolean = false

	constructor(str: string) {
		this.str = str
	}

	public next(): VDFToken | null {

		if (this.peeked != null) {
			const peeked = this.peeked
			this.index = peeked.index
			this.line = peeked.line
			this.character = peeked.character
			this.peeked = null
			return peeked.token
		}

		let index = this.index
		let line = this.line
		let character = this.character

		while (index < this.str.length && VDFTokeniser.whiteSpaceIgnore.has(this.str[index])) {
			index++
			character++
		}

		if (index >= this.str.length) {
			if (this._EOFRead) {
				const position = new VDFPosition(line, character)
				throw new UnexpectedEndOfFileError(["token"], new VDFRange(position, position))
			}
			// The VDF Parser will need to read the last token twice, once for checking conditional
			// and then again for checking that the last key is null
			this._EOFRead = true
			return null
		}

		let token: VDFToken

		switch (this.str[index]) {
			case "\n": {
				const range = new VDFRange(
					new VDFPosition(line, character),
					new VDFPosition(line, character + 1),
				)

				token = {
					type: VDFTokenType.NewLine,
					value: "\n",
					range: range,
					exteriorRange: range
				}

				index++
				line++
				character = 0
				break
			}
			case "{": {
				const range = new VDFRange(
					new VDFPosition(line, character),
					new VDFPosition(line, character + 1),
				)

				token = {
					type: VDFTokenType.OpeningBrace,
					value: "{",
					range: range,
					exteriorRange: range
				}

				index++
				character++
				break
			}
			case "}": {
				const range = new VDFRange(
					new VDFPosition(line, character),
					new VDFPosition(line, character + 1),
				)

				token = {
					type: VDFTokenType.ClosingBrace,
					value: "}",
					range: range,
					exteriorRange: range
				}

				index++
				character++
				break
			}
			case "[": {
				const start = index
				const startPosition = new VDFPosition(line, character)
				while (this.str[index] != "]") {
					if (index >= this.str.length) {
						throw new UnexpectedEndOfFileError(["']'"], new VDFRange(startPosition, new VDFPosition(line, character)))
					}
					if (this.str[index] == "\n") {
						throw new UnexpectedCharacterError("'\\n'", ["']'"], new VDFRange(startPosition, new VDFPosition(line, character)))
					}
					index++
					character++
				}
				index++
				character++
				const end = index
				const endPosition = new VDFPosition(line, character)
				const value = this.str.slice(start, end)
				const range = new VDFRange(
					startPosition,
					endPosition
				)
				token = {
					type: VDFTokenType.Conditional,
					value: <`[${string}]`>value,
					range: range,
					exteriorRange: range,
				}
				break
			}
			case "\"": {
				const exteriorStartPosition = new VDFPosition(line, character)
				index++
				character++
				const startPosition = new VDFPosition(line, character)
				const start = index
				while (this.str[index] != "\"") {
					if (index >= this.str.length) {
						throw new UnexpectedEndOfFileError(["'\"'"], new VDFRange(startPosition, new VDFPosition(line, character)))
					}
					if (this.str[index] == "\n") {
						if (this.allowMultilineString) {
							line++
							character = 0
						}
						else {
							throw new UnexpectedCharacterError("'\\n'", ["'\"'"], new VDFRange(startPosition, new VDFPosition(line, character)))
						}
					}
					else if (this.str[index] == "\\") {
						// Increment character only, index is incremented at the end of the loop because an iteration could be a newline
						character++
						if (index >= this.str.length) {
							throw new UnclosedEscapeSequenceError(new VDFRange(startPosition, new VDFPosition(line, character)))
						}
						index++
						character++
					}
					else {
						character++
					}
					index++
				}
				const end = index
				const endPosition = new VDFPosition(line, character)
				index++
				character++
				const exteriorEndPosition = new VDFPosition(line, character)
				token = {
					type: VDFTokenType.String,
					value: this.str.slice(start, end),
					range: new VDFRange(startPosition, endPosition),
					exteriorRange: new VDFRange(exteriorStartPosition, exteriorEndPosition)
				}
				break
			}
			default: {
				if (this.str[index] == "/" && index + 1 < this.str.length && this.str[index + 1] == "/") {

					index += 2 // Skip '//'

					const start = index
					const startPosition = new VDFPosition(line, character)

					while (index < this.str.length && this.str[index] != "\n") {
						index++
						character++
					}

					const end = index
					const endPosition = new VDFPosition(line, character)

					const range = new VDFRange(
						startPosition,
						endPosition
					)

					token = {
						type: VDFTokenType.Comment,
						value: this.str.slice(start, end).trim(),
						range: range,
						exteriorRange: range
					}
				}
				else {
					const start = index
					const startPosition = new VDFPosition(line, character)
					while (index < this.str.length && this.str[index] != "\n" && !VDFTokeniser.whiteSpaceIgnore.has(this.str[index])) {
						if (VDFTokeniser.whiteSpaceTokenTerminate.has(this.str[index])) {
							break
						}
						index++
						character++
					}
					const end = index
					const endPosition = new VDFPosition(line, character)
					const value = this.str.slice(start, end)
					const range = new VDFRange(
						startPosition,
						endPosition
					)
					token = {
						type: VDFTokenType.String,
						value: value,
						range: range,
						exteriorRange: range
					}
				}
				break
			}
		}

		this.index = index
		this.line = line
		this.character = character

		return token
	}

	public peek() {
		this.peeked ??= {
			token: this.next(),
			index: this.index,
			line: this.line,
			character: this.character
		}

		return this.peeked.token
	}

	/**
	 * Skip `VDFTokenType.Comment` and `VDFTokenType.NewLine` tokens
	 */
	public token(): Exclude<VDFToken, { type: VDFTokenType.Comment } | { type: VDFTokenType.NewLine }> | null {
		while (true) {
			const token = this.next()
			if (token == null) {
				return token
			}

			if (token.type != VDFTokenType.Comment && token.type != VDFTokenType.NewLine) {
				return token
			}
		}
	}

	/**
	 * Consumes and returns the next token if it is a conditional, consuming comments and newlines
	 */
	public conditional(): Extract<VDFToken, { type: VDFTokenType.Conditional }>["value"] | null {
		while (true) {
			try {
				const token = this.peek()
				if (token == null) {
					return token
				}

				if (token.type == VDFTokenType.Comment || token.type == VDFTokenType.NewLine) {
					this.next()
				}
				else if (token.type == VDFTokenType.Conditional) {
					this.next()
					return token.value
				}
				else {
					return null
				}
			}
			catch (error) {
				return null
			}
		}
	}

	/**
	 * Skip `VDFTokenType.NewLine` tokens
	 */
	public format() {
		while (true) {
			const token = this.next()
			if (token == null) {
				return token
			}

			if (token.type != VDFTokenType.NewLine) {
				return token
			}
		}
	}
}
