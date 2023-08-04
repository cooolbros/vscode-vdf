import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"

export function VDFFormat(str: string, options: VDFFormatStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str), options)
}
