import { VDFTokeniser } from "./VDFTokeniser"

/**
 * A modified VDFTokeniser that returns comments and newline characters
 */
export class VDFFormatTokeniser extends VDFTokeniser {
	private static readonly whiteSpaceIgnoreFormat: string[] = [" ", "\t", "\r"]

	public next(lookAhead = false): string {
		throw new Error()
	}

	public read({ lookAhead = false, skipNewlines = false }: { lookAhead?: boolean, skipNewlines?: boolean } = {}): string {

		let i = this.position
		let currentToken = ""

		while (i < this.str.length && VDFFormatTokeniser.whiteSpaceIgnore.includes(this.str[i])) {
			if (this.str[i] == "\n" && !skipNewlines) {
				if (!lookAhead) {
					this.position = i
				}
				return "\n"
			}
			i++
		}

		if (i >= this.str.length) {
			if (!lookAhead) {
				if (this._EOFRead) {
					throw new Error("Attempted to read past the end of the stream") // end of stream
				}
				this._EOFRead = true
			}
			return "__EOF__"
		}

		if (this.str[i] == "\"") {
			currentToken += "\""
			i++ // Skip over opening quote
			while (this.str[i] != "\"") {
				if (this.str[i] == "\\") {
					// Add backslash
					currentToken += "\\"
					i++

					if (i >= this.str.length) {
						throw new Error("Unclosed escape sequence") // unclosed escape sequence
					}

					// Add character
					currentToken += this.str[i]
					i++
				}
				else {
					currentToken += this.str[i]
					i++
				}

				if (i >= this.str.length) {
					throw new Error(`Unclosed quoted token "${currentToken}"!`) // missing double quote
				}
			}
			currentToken += "\""
			i++ // Skip over closing quote
		}
		else {
			if (this.str[i] == "/" && i + 1 < this.str.length && this.str[i + 1] == "/") {
				// Comment
				while (i < this.str.length && this.str[i] != "\n") {
					currentToken += this.str[i]
					i++
				}
			}
			else {
				while (i < this.str.length && !VDFFormatTokeniser.whiteSpaceIgnoreFormat.includes(this.str[i])) {
					if (this.str[i] == "\\") {
						// Add backslash
						currentToken += "\\"
						i++

						if (i >= this.str.length) {
							throw new Error("Unclosed escape sequence at EOF!")
						}

						// Add character
						currentToken += this.str[i]
						i++
					}
					else {
						// ", {, } terminate a whitespace initiated token, but are not added
						if (["\"", "{", "}", "\n"].includes(this.str[i])) {
							if (currentToken == "") {
								currentToken += this.str[i]
								i++
							}
							break
						}
						else {
							currentToken += this.str[i]
							i++
						}
					}
				}
			}
		}

		if (!lookAhead) {
			this.position = i
		}

		return currentToken
	}

}
