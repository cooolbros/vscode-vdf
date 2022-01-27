import { Range } from "vscode-languageserver"

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
	public range: Range
	constructor(message: string, range: Range) {
		super(message)
		this.range = range
	}
}

export class UnexpectedCharacterError extends VDFSyntaxError {
	constructor(unexpected: string, expected: string, range: Range) {
		unexpected = unexpected
			.replace("\t", "\\t")
			.replace("\r", "\\r")
			.replace("\n", "\\n")
		super(`Unexpected "${unexpected}"! Expected "${expected}"`, range)
	}
}

/**
 *
 */
export class UnexpectedTokenError extends VDFSyntaxError {
	constructor(unexpected: string, expected: string, range: Range) {
		super(`Unexpected "${unexpected}"! Expected ${expected}`, range)
	}
}

/**
 *
 */
export class UnclosedEscapeSequenceError extends VDFSyntaxError {
	constructor(range: Range) {
		super(`Unclosed escape sequence! Expected char`, range)
	}
}

/**
 *
 */
export class EndOfStreamError extends VDFSyntaxError {
	constructor(range: Range) {
		super("Attempted to read past the end of the stream", range)
	}
}
