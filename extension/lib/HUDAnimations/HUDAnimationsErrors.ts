import { Range } from "vscode-languageserver"
import { VDFSyntaxError } from "../../VDF/dist/VDFErrors"

export class HUDAnimationsSyntaxError extends VDFSyntaxError {
	constructor(unExpectedToken: string, position: { position: number, line: number, character: number }, message?: string) {
		super(`Unexpected "${unExpectedToken}" at position ${position.position} (line ${position.line}, character ${position.character})!${message ? ` ${message}` : ""}`, Range.create(position.line, position.character - unExpectedToken.length, position.line, position.character))
	}
}
