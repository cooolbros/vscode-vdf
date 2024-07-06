import type { VDFTokeniserOptions } from "vdf"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"

export function VDFFormat(str: string, tokeniserOptions: VDFTokeniserOptions, stringifyOptions: VDFFormatStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str, tokeniserOptions), stringifyOptions)
}
