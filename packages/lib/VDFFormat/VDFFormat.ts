import type { VDFTokeniserOptions } from "../VDF/VDFTokeniserOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"

export function VDFFormat(str: string, tokeniserOptions: VDFTokeniserOptions, stringifyOptions: VDFFormatStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str, tokeniserOptions), stringifyOptions)
}
