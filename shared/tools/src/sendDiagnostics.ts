import { Diagnostic, DiagnosticSeverity, _Connection } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { VDFSyntaxError } from "../../VDF/dist/VDFErrors";

/**
 *
 * @param connection connection to send diagnostics to
 * @param parser Document validator. If the data parameter passed in is a TextDocument, use this parser to retrieve the results
 */
export function _sendDiagnostics<T>(connection: _Connection, parse: (str: string) => T, validate: (data: T) => Diagnostic[]) {

	/**
	 * @param uri document to get diagnostics of
	 * @param data data to validate
	 */
	return function(uri: string, data: TextDocument | VDFSyntaxError | Diagnostic[]) {

		let diagnostics: Diagnostic[]
		let result: T | undefined

		if (Array.isArray(data)) {
			diagnostics = data
		}
		else if (data instanceof VDFSyntaxError) {
			diagnostics = [
				{
					severity: DiagnosticSeverity.Error,
					message: data.message,
					range: data.range,
					source: "VDFSyntaxError",
					code: data.constructor.name,
				}
			]
		}
		else {
			try {
				result = parse(data.getText())
				diagnostics = validate(result)
			}
			catch (e: unknown) {
				if (e instanceof VDFSyntaxError) {
					diagnostics = [
						{
							severity: DiagnosticSeverity.Error,
							message: e.message,
							range: e.range,
							source: "VDFSyntaxError",
							code: e.constructor.name,
						}
					]
				}
				else {
					throw e
				}
			}
		}

		connection.sendDiagnostics({
			uri: uri,
			diagnostics: diagnostics
		})

		return result
	}
}
