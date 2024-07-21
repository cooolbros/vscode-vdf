import type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"
import { getHUDAnimationsFormatDocumentSymbols } from "./getHUDAnimationsFormatDocumentSymbols"
import { printHUDAnimationsFormatDocumentSymbols } from "./printHUDAnimationsFormatDocumentSymbols"

export type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"

export function formatHUDAnimations(str: string, options: HUDAnimationsFormatStringifyOptions): string {
	return printHUDAnimationsFormatDocumentSymbols(getHUDAnimationsFormatDocumentSymbols(str), options)
}
