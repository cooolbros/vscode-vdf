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
	public range: VDFRange
	constructor(unexpected: string, expected: string[], range: VDFRange) {
		super(`Unexpected ${unexpected}. Expected ${expected.join(" | ")}.`)
		this.range = range
	}
}

export class UnexpectedCharacterError extends VDFSyntaxError {
	constructor(unexpected: string, expected: string[], range: VDFRange) {
		super(unexpected, expected, range)
	}
}

export class UnclosedEscapeSequenceError extends VDFSyntaxError {
	constructor(range: VDFRange) {
		super("Unclosed escape sequence", ["char"], range)
	}
}

export class EndOfStreamError extends VDFSyntaxError {
	constructor(expected: string[], range: VDFRange) {
		super("EOF", expected, range)
	}
}

export class UnexpectedTokenError extends VDFSyntaxError {
	constructor(unexpected: `'${string}'`, expected: string[], range: VDFRange) {
		super(unexpected, expected, range)
	}
}
