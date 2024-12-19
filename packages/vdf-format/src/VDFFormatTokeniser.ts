import { UnexpectedEndOfFileError, VDFPosition, VDFRange, VDFTokeniser } from "vdf"

export const enum VDFFormatTokenType {
	String,
	Conditional,
	ControlCharacter,
	NewLine,
	Comment
}

export interface VDFFormatToken {
	type: VDFFormatTokenType
	value: string
}

/**
 * A modified VDFTokeniser that returns comments and newline characters
 */
export class VDFFormatTokeniser {

	/**
	 * ```ts
	 * readonly [" ", "\t", "\r"]
	 * ```
	 */
	public static readonly whiteSpaceIgnore = new Set([" ", "\t", "\r"])

	/**
	 * ```ts
	 * readonly [" ", "\t", "\r", "\n"]
	 * ```
	 */
	public static readonly whiteSpaceIgnore_skipNewLines = new Set([...VDFFormatTokeniser.whiteSpaceIgnore, "\n"])

	private readonly str: string

	/**
	 * Zero-based offset position
	 */
	public index = 0

	// EOF
	private _EOFRead = false

	constructor(str: string) {
		this.str = str
	}

	public next({ skipNewlines, allowMultilineString = false, peek = false }: { skipNewlines: boolean, allowMultilineString?: boolean, peek?: boolean }): VDFFormatToken | null {

		let index = this.index

		const whiteSpaceIgnore = skipNewlines
			? VDFFormatTokeniser.whiteSpaceIgnore_skipNewLines
			: VDFFormatTokeniser.whiteSpaceIgnore

		while (index < this.str.length && whiteSpaceIgnore.has(this.str[index])) {
			index++
		}

		if (index >= this.str.length) {
			if (this._EOFRead) {
				throw new UnexpectedEndOfFileError(["token"], new VDFRange(new VDFPosition(0, 0)))
			}
			if (!peek) {
				this._EOFRead = true
			}
			return null
		}

		let token: VDFFormatToken

		switch (this.str[index]) {
			case "{":
			case "}": {
				token = {
					type: VDFFormatTokenType.ControlCharacter,
					value: this.str[index]
				}
				index++
				break
			}
			case "\n": {
				token = {
					type: VDFFormatTokenType.NewLine,
					value: this.str[index]
				}
				index++
				break
			}
			case "\"": {
				index++
				const start = index
				while (this.str[index] != "\"") {
					if (index >= this.str.length) {
						throw new Error()
					}
					else if (this.str[index] == "\n" && !allowMultilineString) {
						throw new Error()
					}
					else if (this.str[index] == "\\") {
						if (index >= this.str.length) {
							throw new Error()
						}
						index++
					}
					index++
				}
				const end = index
				index++
				token = {
					type: VDFFormatTokenType.String,
					value: this.str.slice(start, end)
				}
				break
			}
			// @ts-ignore
			case "/": {
				if (this.str[index + 1] == "/") {
					index += 2 // Skip //
					const start = index
					while (index < this.str.length && this.str[index] != "\n") {
						index++
					}
					const end = index
					token = {
						type: VDFFormatTokenType.Comment,
						value: this.str.slice(start, end).trim() // Remove '\r'
					}
					break
				}
			}
			default: {
				const start = index
				while (index < this.str.length && !VDFTokeniser.whiteSpaceIgnore.has(this.str[index])) {
					if (VDFTokeniser.whiteSpaceTokenTerminate.has(this.str[index])) {
						break
					}
					index++
				}
				const end = index
				const value = this.str.slice(start, end)
				token = {
					type: value.startsWith("[") && value.endsWith("]") ? VDFFormatTokenType.Conditional : VDFFormatTokenType.String,
					value: value
				}
				break
			}
		}

		if (!peek) {
			this.index = index
		}

		return token
	}
}
