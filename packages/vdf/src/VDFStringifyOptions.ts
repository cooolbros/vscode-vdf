import type { VDFIndentation } from "./VDFIndentation"
import type { VDFNewLine } from "./VDFNewLine"

export interface VDFStringifyOptions {
	indentation: VDFIndentation
	newLine: VDFNewLine
	tabSize: number
}
