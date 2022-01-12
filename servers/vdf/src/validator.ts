import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { VDFDocumentSymbol } from "../../../shared/tools/src/tools";
import { VDF } from "../../../shared/vdf";

export function validate(documentSymbols: VDFDocumentSymbol[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = []

	const addDiagnostics = (objectPath: string[], _documentSymbols: VDFDocumentSymbol[]): void => {
		for (const { name, key, value, children, valueRange } of _documentSymbols) {
			if (value && valueRange) {
				const _key = key.split(VDF.OSTagDelimeter)[0].toLowerCase()
				const _value = value.toLowerCase()
				switch (_key) {
					case "fieldname":
						{
							// fieldName must match element name
							const elementName = objectPath[objectPath.length - 1].split(VDF.OSTagDelimeter)[0]
							if (_value != elementName.toLowerCase()) {
								diagnostics.push({
									message: `fieldName "${value}" does not match element name "${elementName}"`,
									range: valueRange,
									severity: DiagnosticSeverity.Warning,
								})
							}
							break
						}
					case "pin_to_sibling":
						{
							// Element should not be pinned to itself
							const elementName = objectPath[objectPath.length - 1].split(VDF.OSTagDelimeter)[0]
							if (_value == elementName.toLowerCase()) {
								diagnostics.push({
									message: `Element "${elementName}" is pinned to itself!`,
									range: valueRange,
									severity: DiagnosticSeverity.Warning,
								})
							}
							break
						}
				}
			}
			else if (children) {
				objectPath.push(key)
				addDiagnostics(objectPath, children)
				objectPath.pop()
			}
		}
	}

	addDiagnostics([], documentSymbols)

	return diagnostics
}