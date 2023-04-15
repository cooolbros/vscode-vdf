import type { VDFRange } from "./VDFRange"

export const enum VDFTokenType {
	String,
	Conditional,
	ControlCharacter,
}

export interface VDFToken {
	type: VDFTokenType
	value: string
	range: VDFRange
}
