export interface VDFTokeniserOptions {
	allowMultilineStrings?: boolean
	osTags?: VDFOSTags
}

export enum VDFOSTags {
	None,
	Strings,
	Objects,
	All
}

export class VDFSyntaxError extends Error {
	line: number
	character: number
	constructor(message: string, line: number, character: number) {
		super(message)
		this.line = line
		this.character = character
	}
}

export class VDFTokeniser {

	// Setup
	str: string
	options: VDFTokeniserOptions

	// Parser State
	position: number = 0
	line: number = 0
	character: number = 0
	quoted: 0 | 1 = 0

	// Parser Constants
	private static readonly whiteSpaceIgnore: string[] = [" ", "\t", "\r", "\n"]

	constructor(str: string, options?: VDFTokeniserOptions) {
		this.str = str
		this.options = {
			allowMultilineStrings: options?.allowMultilineStrings ?? false,
			osTags: options?.osTags ?? VDFOSTags.All
		}
	}

	next(lookAhead: boolean = false): string {
		let currentToken: string = ""
		let j: number = this.position
		let _line: number = this.line
		let _character: number = this.character
		let _quoted: 0 | 1 = this.quoted
		if (j >= this.str.length - 1) {
			return "EOF"
		}
		while ((VDFTokeniser.whiteSpaceIgnore.includes(this.str[j]) || this.str[j] == "/") && j <= this.str.length - 1) {
			if (this.str[j] == '\n') {
				_line++
				_character = 0
			}
			else {
				_character++
			}
			if (this.str[j] == '/') {
				if (this.str[j + 1] == '/') {
					while (this.str[j] != '\n') {
						j++
						// _character++
					}
				}
			}
			else {
				j++
				// _character++
			}
			if (j >= this.str.length) {
				return "EOF"
			}
		}
		if (this.str[j] == "\"") {
			// Read until next quote (ignore opening quote)
			_quoted = 1
			j++ // Skip over opening double quote
			_character++ // Skip over opening double quote
			while (this.str[j] != "\"" && j < this.str.length) {
				if (this.str[j] == '\n') {
					if (!this.options.allowMultilineStrings) {
						throw new VDFSyntaxError(`Unexpected EOL at position ${j} (line ${_line + 1}, position ${_character + 1})! Are you missing a closing double quote?`, _line, _character)
					}
					else {
						_line++
						_character = 0
					}
				}
				if (this.str[j] == "\\") {
					j++
					_character++
					currentToken += this.str[j]
					j++
					_character++
				}
				else {
					currentToken += this.str[j]
					j++
					_character++
				}
			}
			j++ // Skip over closing quote
			_character++ // Skip over closing quote
		}
		else {
			// Read until whitespace (or end of file)
			_quoted = 0
			while (!VDFTokeniser.whiteSpaceIgnore.includes(this.str[j]) && j < this.str.length - 1) {
				if (this.str[j] == "\"") {
					throw new VDFSyntaxError(`Unexpected " at position ${j} (line ${this.line}, position ${this.character})! Are you missing terminating whitespace?`, _line, _character)
				}
				if (this.str[j] == "\\") {
					j++
					_character++
					currentToken += this.str[j]
					j++
					_character++
				}
				else {
					currentToken += this.str[j]
					j++
					_character++
				}
			}
		}
		if (!lookAhead) {
			this.position = j
			this.line = _line
			this.character = _character
			this.quoted = _quoted
		}
		return currentToken
	}
}