import { Position, Range } from "vscode-languageserver"
import { VDFOSTags } from "./models/VDFOSTags"
import { VDFTokeniserOptions } from "./models/VDFTokeniserOptions"
import { EndOfStreamError, UnclosedEscapeSequenceError, UnexpectedCharacterError } from "./VDFErrors"

export class VDFTokeniser {
	public static readonly whiteSpaceIgnore: string[] = [" ", "\t", "\r", "\n"]
	public static readonly whiteSpaceTokenTerminate: string[] = ["\"", "{", "}"]
	protected readonly str: string
	public readonly options: VDFTokeniserOptions

	/**
	 * Zero-based offset position
	 */
	public position = 0

	/**
	 * Zero-based line number
	 */
	public line = 0

	/**
	 * Zero-based character number in current line
	 */
	public character = 0

	// Peek
	protected _peekToken: string | null = null
	protected _peekPosition = 0
	protected _peekLine = 0
	protected _peekCharacter = 0

	// EOF
	protected _EOFRead = false

	constructor(str: string, options?: VDFTokeniserOptions) {
		this.str = str
		this.options = {
			allowMultilineStrings: options?.allowMultilineStrings ?? false,
			osTags: options?.osTags ?? VDFOSTags.All
		}
	}
	public next(lookAhead = false): string {

		// If a token has already been calculated using next(true), retrieve and return the token from cache
		let currentToken = ""
		if (this._peekToken != null) {
			currentToken = this._peekToken
			this.position = this._peekPosition
			this.line = this._peekLine
			this.character = this._peekCharacter
			this._peekToken = null
			return currentToken
		}

		let i: number = this.position
		let line: number = this.line
		let character: number = this.character
		let tokenStartPosition: Position

		while (i < this.str.length && (VDFTokeniser.whiteSpaceIgnore.includes(this.str[i]) || this.str[i] == "/")) {
			if (this.str[i] == "\n") {
				line++
				character = 0
			}
			else if (this.str[i] == "/") {
				const i1 = i + 1
				if (i1 < this.str.length && this.str[i1] == "/") {
					i++
					while (i < this.str.length && this.str[i] != "\n") {
						i++
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
			i++
		}

		if (i >= this.str.length) {
			if (!lookAhead) {
				if (this._EOFRead) {
					throw new EndOfStreamError(Range.create(Position.create(this.line, this.character), Position.create(line, character)))
				}
				this._EOFRead = true
			}
			return "__EOF__"
		}

		if (this.str[i] == "\"") {
			// Read until next quote (ignore opening quote)

			tokenStartPosition = Position.create(line, character)

			currentToken += "\""
			i++
			character++

			while (this.str[i] != "\"") {
				if (this.str[i] == "\n") {
					if (!this.options.allowMultilineStrings) {
						throw new UnexpectedCharacterError("\n", "\"", Range.create(tokenStartPosition, Position.create(line, character)))
					}
					else {
						line++
						character = 0
					}
				}
				else if (this.str[i] == "\\") {
					// Add backslash
					currentToken += "\\"
					i++
					character++

					if (i >= this.str.length) {
						throw new UnclosedEscapeSequenceError(Range.create(tokenStartPosition, Position.create(line, character)))
					}

					// Add character
					currentToken += this.str[i]
					i++
					character++
				}
				else {
					currentToken += this.str[i]
					i++
					character++
				}

				if (i >= this.str.length) {
					throw new UnexpectedCharacterError("EOF", "\"", Range.create(tokenStartPosition, Position.create(line, character))) // missing double quote
				}
			}
			currentToken += "\""
			i++ // Skip over closing quote
			character++ // Skip over closing quote
		}
		else {
			// Read until whitespace (or end of file)

			tokenStartPosition = Position.create(line, character)

			while (i < this.str.length && !VDFTokeniser.whiteSpaceIgnore.includes(this.str[i])) {
				if (this.str[i] == "\\") {
					// Add backslash
					currentToken += "\\"
					i++
					character++

					if (i >= this.str.length) {
						throw new UnclosedEscapeSequenceError(Range.create(tokenStartPosition, Position.create(line, character)))
					}

					// Add character
					currentToken += this.str[i]
					i++
					character++
				}
				else if (VDFTokeniser.whiteSpaceTokenTerminate.includes(this.str[i])) {
					// ", {, } terminate a whitespace initiated token but are not added
					if (currentToken == "") {
						// VDFTokeniser.WhiteSpaceTokenTerminate contains a '"' but it that should not be
						// the case here because if currentToken is "" it would be a quoted token
						currentToken += this.str[i]
						i++
						character++
					}
					break
				}
				else {
					currentToken += this.str[i]
					i++
					character++
				}
			}
		}
		if (!lookAhead) {
			this.position = i
			this.line = line
			this.character = character
		}
		return currentToken
	}
}
