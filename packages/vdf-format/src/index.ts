import type { VDFParserOptions } from "vdf"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
import { getVDFFormatDocumentSymbols } from "./getVDFFormatDocumentSymbols"
import { printVDFFormatDocumentSymbols } from "./printVDFFormatDocumentSymbols"

export type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
export { VDFFormatTokeniser, VDFFormatTokenType, type VDFFormatToken } from "./VDFFormatTokeniser"

export function formatVDF(str: string, parserOptions: VDFParserOptions, stringifyOptions: VDFFormatStringifyOptions): string {
	return printVDFFormatDocumentSymbols(getVDFFormatDocumentSymbols(str, parserOptions), stringifyOptions)
}
