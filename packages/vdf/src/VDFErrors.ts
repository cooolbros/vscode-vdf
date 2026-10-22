import type { VDFRange } from "./VDFRange"

/**
 * Generic Error of VDF type
 * ```ts
 * try
 * {
 * 	// Parse VDF
 * }
 * catch (e: unknown)
 * {
 * 	if (e instance VDFSyntaxError) // true
 * 	{
 * 		// Handle VDFSyntaxError
 * 	}
 * }
 * ```
 */
export abstract class VDFSyntaxError extends Error {
	public abstract readonly name: string
	public range: VDFRange
	public constructor(unexpected: string, expected: string[], range: VDFRange) {
		super(`Unexpected ${unexpected}. Expected ${expected.join(" | ")}.`)
		this.range = range
	}
}

export class UnexpectedCharacterError extends VDFSyntaxError {
	public readonly name = "unexpected-character"
	public constructor(unexpected: string, expected: string[], range: VDFRange) {
		super(unexpected, expected, range)
	}
}

export class UnclosedEscapeSequenceError extends VDFSyntaxError {
	public readonly name = "unclosed-escape-sequence"
	public constructor(range: VDFRange) {
		super("Unclosed escape sequence", ["char"], range)
	}
}

export class UnexpectedEndOfFileError extends VDFSyntaxError {
	public readonly name = "unexpected-end-of-file"
	public constructor(expected: string[], range: VDFRange) {
		super("EOF", expected, range)
	}
}

export class UnexpectedTokenError extends VDFSyntaxError {
	public readonly name = "unexpected-token"
	public constructor(unexpected: `'${string}'`, expected: string[], range: VDFRange) {
		super(unexpected, expected, range)
	}
}
