import type { VDFStringifyOptions } from "$lib/VDF/VDFStringifyOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"

export function VDFFormat(str: string, options: VDFStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str), options)
}
