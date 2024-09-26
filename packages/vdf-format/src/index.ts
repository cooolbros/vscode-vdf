import type { VDFTokeniserOptions } from "vdf"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"

export type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
export { VDFFormatTokeniser, VDFFormatTokenType, type VDFFormatToken } from "./VDFFormatTokeniser"

export function formatVDF(str: string, tokeniserOptions: VDFTokeniserOptions, stringifyOptions: VDFFormatStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str, tokeniserOptions), stringifyOptions)
}
