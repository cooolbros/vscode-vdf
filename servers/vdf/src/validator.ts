import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { VDFDocumentSymbol } from "../../../shared/tools/src/tools";
import { VDF } from "../../../shared/vdf";

const pinValues = [
	"PIN_TOPLEFT",
	"PIN_TOPRIGHT",
	"PIN_BOTTOMLEFT",
	"PIN_BOTTOMRIGHT",
	"PIN_CENTER_TOP",
	"PIN_CENTER_RIGHT",
	"PIN_CENTER_BOTTOM",
	"PIN_CENTER_LEFT"
]

const enumMembers = {
	"textalignment": [
		"center",
		"north",
		"north-east",
		"east",
		"south-east",
		"south",
		"south-west",
		"west",
		"north-est"
	],
	"pin_corner_to_sibling": pinValues,
	"pin_to_sibling_corner": pinValues
}

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
					default:
						{
							if (((key): key is keyof typeof enumMembers => enumMembers.hasOwnProperty(key))(_key)) {
								let i = 0
								let enumValueValid = false
								while (i < enumMembers[_key].length && !enumValueValid) {
									if (enumMembers[_key][i].toLowerCase() == _value) {
										enumValueValid = true
									}
									i++
								}

								if (!enumValueValid) {
									diagnostics.push({
										message: `"${value}" is not a valid value for ${_key}! Expected "${enumMembers[_key].join(`" | "`)}"`,
										range: valueRange,
										severity: DiagnosticSeverity.Warning,
									})
								}
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
