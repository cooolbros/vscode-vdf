import { EndOfStreamError, UnexpectedTokenError } from "$lib/VDF/VDFErrors"
import { VDFPosition } from "$lib/VDF/VDFPosition"
import { VDFRange } from "$lib/VDF/VDFRange"
import { VDFTokeniser } from "$lib/VDF/VDFTokeniser"

/**
 * A modified VDFTokeniser that returns comments and newline characters
 */
export class VDFFormatTokeniser extends VDFTokeniser {

	public static readonly whiteSpaceIgnore = new Set([" ", "\t", "\r"])
	public static readonly whiteSpaceIgnore_skipNewLines = new Set([...VDFFormatTokeniser.whiteSpaceIgnore, "\n"])

	// private static readonly whiteSpaceIgnoreFormat: string[] = [" ", "\t", "\r"]

	constructor(str: string) {
		super(str)
	}

	public next(lookAhead = false, skipNewlines = false): string | null {

		let index = this.index

		const whiteSpaceIgnore = skipNewlines
			? VDFFormatTokeniser.whiteSpaceIgnore_skipNewLines
			: VDFFormatTokeniser.whiteSpaceIgnore

		while (index < this.str.length && whiteSpaceIgnore.has(this.str[index])) {
			index++
		}

		if (index >= this.str.length) {
			if (this._EOFRead) {
				const position = new VDFPosition(0, 0)
				throw new UnexpectedTokenError("EOF", "token", new VDFRange(position))
			}
			this._EOFRead = true
			return null
		}

		const start = index

		if (this.str[index] == "\n") {
			index++
		}
		else if (this.str[index] == "\"") {
			index++
			while (this.str[index] != "\"") {

				if (index >= this.str.length) {
					throw new EndOfStreamError("closing double quote", new VDFRange(new VDFPosition(0, 0)))
				}

				index++
			}
		}
		else if (this.str[index] == "/" && index < this.str.length && this.str[index + 1] == "/") {
			while (index <= this.str.length && this.str[index] != "\n") {
				index++
			}
		}
		else {
			while (index <= this.str.length && !VDFFormatTokeniser.whiteSpaceIgnore.has(this.str[index])) {

				if (VDFTokeniser.whiteSpaceTokenTerminate.has(this.str[index])) {
					if (start == index) {
						index++
					}
					break
				}

				index++
			}
		}

		const end = index

		const token = this.str.slice(start, end)

		if (lookAhead) {
			// this._peek = {
			// 	token,
			// 	index,
			// 	line: 0,
			// 	character: 0,
			// }
		}
		else {
			this.index = index
		}

		return token
	}
}
