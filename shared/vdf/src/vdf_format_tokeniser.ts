import { VDFTokeniser } from "./vdf"

/**
 * A modified VDFTokeniser that returns comments and newline characters
 */
export class VDFFormatTokeniser extends VDFTokeniser {

	private EOFRead: boolean = false


	next(lookAhead: boolean = false): string {
		let j = this.position
		let currentToken = ""

		if (j >= this.str.length) {
			if (!lookAhead) {
				this.position = j
				if (this.EOFRead) {
					throw new Error(`Already read EOF`)
				}
				this.EOFRead = true
			}
			return "EOF"
		}

		// Ignore chars

		while ([" ", "\t", "\r"].includes(this.str[j])) {
			j++
			if (j >= this.str.length) {
				if (!lookAhead) {
					if (this.EOFRead) {
						throw new Error(`Already read EOF`)
					}
					this.EOFRead = true
				}
				return "EOF"
			}
		}

		if (this.str[j] == "\n") {
			j++ // Skip over newline
			if (!lookAhead) {
				this.position = j
			}
			return "\n"
		}

		if (j >= this.str.length) {
			if (!lookAhead) {
				this.position = j
				if (this.EOFRead) {
					throw new Error(`Already read EOF`)
				}
				this.EOFRead
			}
			this.EOFRead = true
			return "EOF"
		}


		if (this.str[j] == "\"") {
			j++ // Skip over opening quote
			this.quoted = 1
			while (this.str[j] != "\"") {
				if (this.str[j] == "\\") {
					// Add backslash
					currentToken += "\\"
					j++

					if (j >= this.str.length) {
						throw new Error()
					}

					// Add character
					currentToken += this.str[j]
					j++
				}
				else {
					currentToken += this.str[j]
					j++
				}

				if (j >= this.str.length) {
					throw new Error(`Unclosed quoted token "${currentToken}"!`)
				}
			}

			j++ // Skip over closing quote
		}
		else {
			this.quoted = 0
			if (this.str[j] == "/" && j + 1 < this.str.length && this.str[j + 1] == "/") {
				// Comment
				while (j < this.str.length && this.str[j] != "\r" && this.str[j] != "\n") {
					currentToken += this.str[j]
					j++
				}
			}
			else {
				while (j < this.str.length && ![" ", "\t", "\r"].includes(this.str[j])) {
					if (this.str[j] == "\\") {
						// Add backslash
						currentToken += "\\"
						j++

						if (j >= this.str.length) {
							throw new Error(`Unclosed escape sequence at EOF!`)
						}

						// Add character
						currentToken += this.str[j]
						j++
					}
					else {
						// ", {, } terminate a whitespace initiated token, but are not added
						if (["\"", "{", "}", "\n"].includes(this.str[j])) {
							if (currentToken == "") {
								currentToken += this.str[j]
								j++
							}
							// connection.console.log(`Breaking out of "${currentToken}" (Encountered "${escape(str[j])}")`)
							break
						}
						else {
							currentToken += this.str[j]
							j++
						}
					}
				}

				if (this.str[j] == "\r") {
					j++
				}
			}
		}

		if (!lookAhead) {
			this.position = j
			// connection.console.log(`Returning ${currentToken}`)
		}

		return currentToken
	}

}