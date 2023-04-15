import { getHUDAnimationsFormatDocumentSymbols } from "./getHUDAnimationsFormatDocumentSymbols"
import type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"
import { printHUDAnimationsFormatDocumentSymbols } from "./printHUDAnimationsFormatDocumentSymbols"

export function HUDAnimationsFormat(str: string, options: HUDAnimationsFormatStringifyOptions): string {
	return printHUDAnimationsFormatDocumentSymbols(getHUDAnimationsFormatDocumentSymbols(str), options)
}
