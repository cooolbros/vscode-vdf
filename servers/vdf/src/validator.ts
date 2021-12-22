import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { VDFDocumentSymbol } from "../../../shared/tools/src/tools";
import { VDF } from "../../../shared/vdf";

export function validate(documentSymbols: VDFDocumentSymbol[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = []

	const addDiagnostics = (objectPath: string[], _documentSymbols: VDFDocumentSymbol[]): void => {
		for (const { name, key, value, children, valueRange } of _documentSymbols) {
			if (value && valueRange) {
				let _key = name.toLowerCase()
				const _value = value.toLowerCase()
				switch (_key) {
					case "fieldname":
						{
							// fieldName must match element name
							const elementName = objectPath[objectPath.length - 1].split(VDF.OSTagDelimeter)[0].toLowerCase()
							if (elementName != _value) {
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
							if (_value == key.split(VDF.OSTagDelimeter)[0]) {
								diagnostics.push({
									message: `Element "${objectPath[objectPath.length - 1]}" is pinned to itself!`,
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