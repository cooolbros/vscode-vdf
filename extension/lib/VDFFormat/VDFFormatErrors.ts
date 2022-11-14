/**
 * The formatter encountered a sequence of tokens that it cannot resolve the layout of
 */
export class InvalidTokenSequenceError extends Error {
	constructor(...tokens: string[]) {
		super(`Invalid token sequence! ("${tokens.map((token) => token.replace("\n", "\\n")).join("\", \"")}")`)
	}
}
