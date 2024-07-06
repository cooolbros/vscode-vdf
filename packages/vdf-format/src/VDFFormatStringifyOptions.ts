import type { VDFIndentation, VDFNewLine } from "vdf"

export interface VDFFormatStringifyOptions {
	indentation: VDFIndentation
	insertFinalNewline: boolean
	insertNewlineBeforeObjects: boolean
	newLine: VDFNewLine
	quotes: boolean
	tabs: number
	tabSize: number
}
