import type { VDFIndentation } from "../VDF/VDFIndentation"
import type { VDFNewLine } from "../VDF/VDFNewLine"

export interface VDFFormatStringifyOptions {
	indentation: VDFIndentation
	insertFinalNewline: boolean
	insertNewlineBeforeObjects: boolean
	newLine: VDFNewLine
	quotes: boolean
	tabs: number
	tabSize: number
}
