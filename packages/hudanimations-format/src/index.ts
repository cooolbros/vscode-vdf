import { getHUDAnimationsFormatKeyValues } from "./getHUDAnimationsFormatKeyValues"
import type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"
import { printHUDAnimationsFormatKeyValues } from "./printHUDAnimationsFormatKeyValues"

export type { HUDAnimationsFormatStringifyOptions } from "./HUDAnimationsFormatStringifyOptions"

export function formatHUDAnimations(str: string, options: HUDAnimationsFormatStringifyOptions): string {
	return printHUDAnimationsFormatKeyValues(getHUDAnimationsFormatKeyValues(str), options)
}
