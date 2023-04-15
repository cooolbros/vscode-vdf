import type { VDFNewLine } from "../VDF/VDFNewLine"
import type { VDFIndentation } from "./VDFIndentation"

export interface VDFStringifyOptions {
	indentation: VDFIndentation
	newLine: VDFNewLine
	tabSize: number
}
