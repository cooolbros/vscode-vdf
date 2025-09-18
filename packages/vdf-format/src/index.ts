import type { VDFParserOptions } from "vdf"
import type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"
import { getVDFFormatKeyValues } from "./getVDFFormatKeyValues"
import { printVDFFormatKeyValues } from "./printVDFFormatKeyValues"

export type { VDFFormatStringifyOptions } from "./VDFFormatStringifyOptions"

export function formatVDF(str: string, parserOptions: VDFParserOptions, stringifyOptions: VDFFormatStringifyOptions): string {
	return printVDFFormatKeyValues(getVDFFormatKeyValues(str, parserOptions), stringifyOptions)
}
