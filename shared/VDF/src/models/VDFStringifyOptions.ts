import { VDFIndentation } from "./VDFIndentation";
import { VDFNewLine } from "./VDFNewLine";

export interface VDFStringifyOptions {
	indentation?: VDFIndentation
	tabSize?: number
	newLine?: VDFNewLine
	order?: string[] | null
}
