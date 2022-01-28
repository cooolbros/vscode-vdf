import { AssertionError } from "assert";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { VDFDocumentSymbol } from "../../../shared/tools";
import { VDF } from "../../../shared/VDF/dist/VDF";

const pinValues = [
	"PIN_TOPLEFT",       // 0
	"PIN_TOPRIGHT",      // 1
	"PIN_BOTTOMLEFT",    // 2
	"PIN_BOTTOMRIGHT",   // 3
	"PIN_CENTER_TOP",    // 4
	"PIN_CENTER_RIGHT",  // 5
	"PIN_CENTER_BOTTOM", // 6
	"PIN_CENTER_LEFT"    // 7
]

const enumMembers = {
	"pin_corner_to_sibling": pinValues,
	"pin_to_sibling_corner": pinValues,
}

const unionTypes = {
	"textalignment": [
		// textAlignment is not a real enum -- no numbers are allowed
		"north-west",
		"north",
		"north-east",
		"west",
		"center",
		"east",
		"south-west",
		"south",
		"south-east",
		"left",
		"right",
	],
}

export function validate(documentSymbols: VDFDocumentSymbol[]): Diagnostic[] {

	const diagnostics: Diagnostic[] = []

	const addDiagnostics = (objectPath: string[], _documentSymbols: VDFDocumentSymbol[]): void => {
		for (const { key, detail, children, detailRange } of _documentSymbols) {
			if (detail && detailRange) {
				const _key = key.split(VDF.OSTagDelimeter)[0].toLowerCase()
				const _value = detail.toLowerCase()
				switch (_key) {
					case "fieldname":
						{
							// fieldName must match element name
							const elementName = objectPath[objectPath.length - 1]?.split(VDF.OSTagDelimeter)[0]
							if (elementName != undefined && _value != elementName?.toLowerCase()) {
								diagnostics.push({
									message: `fieldName "${detail}" does not match element name "${elementName}"`,
									range: detailRange,
									severity: DiagnosticSeverity.Warning,
								})
							}
							break
						}
					case "pin_to_sibling":
						{
							// Element should not be pinned to itself
							const elementName = objectPath[objectPath.length - 1]?.split(VDF.OSTagDelimeter)[0]
							if (elementName != undefined && _value == elementName?.toLowerCase()) {
								diagnostics.push({
									message: `Element "${elementName}" is pinned to itself!`,
									range: detailRange,
									severity: DiagnosticSeverity.Warning,
								})
							}
							break
						}
					default:
						{
							if (((key): key is keyof typeof enumMembers => enumMembers.hasOwnProperty(key))(_key)) {

								// If the value contains any letters it must be matched to an enum values
								if (/\D/.test(_value)) {
									// Enum members are case insensitive
									const result = enumMembers[_key].find(x => x.toLowerCase() == _value)
									if (result == undefined) {
										diagnostics.push({
											message: `"${detail}" is not a valid value for ${_key}! Expected "${enumMembers[_key].join(`" | "`)}"`,
											range: detailRange,
											severity: DiagnosticSeverity.Warning,
										})
									}
								}
								else {
									// Numbers just have to be in the enum range
									const ivalue = parseInt(_value)
									if (isNaN(ivalue)) {
										throw new AssertionError({ expected: "number", actual: ivalue })
									}
									if (ivalue < 0 || ivalue > enumMembers[_key].length - 1) {
										diagnostics.push({
											message: `"${detail}" is not a valid value for ${_key}! Expected "${enumMembers[_key].join(`" | "`)}"`,
											range: detailRange,
											severity: DiagnosticSeverity.Warning,
										})
									}
								}
							}
							if (((key): key is keyof typeof unionTypes => unionTypes.hasOwnProperty(key))(_key)) {
								if (!unionTypes[_key].includes(_value)) {
									diagnostics.push({
										message: `"${detail}" is not a valid value for ${_key}! Expected "${unionTypes[_key].join(`" | "`)}"`,
										range: detailRange,
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
