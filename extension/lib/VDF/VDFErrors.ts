import { VDFRange } from "./VDFRange"

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
	constructor(message: string, range: VDFRange) {
		super(message)
		this.range = range
	}
}

/**
 *
 */
export class UnexpectedTokenError extends VDFSyntaxError {
	constructor(unexpected: `"${string}"` | "EOF", expected: string, range: VDFRange) {
		super(`Unexpected ${unexpected}! Expected ${expected}`, range)
	}
}

/**
 * File ends with \
 */
export class UnclosedEscapeSequenceError extends VDFSyntaxError {
	constructor(range: VDFRange) {
		super("Unclosed escape sequence! Expected char", range)
	}
}

/**
 * Unexpected End of File
 */
export class EndOfStreamError extends UnexpectedTokenError {
	constructor(expected: string, range: VDFRange) {
		super("EOF", expected, range)
	}
}
