import type { VDFRange } from "./VDFRange"

export const enum VDFTokenType {
	String,
	Conditional,
	ControlCharacter,
}

export type VDFToken = ({ type: VDFTokenType.String, value: string } | { type: VDFTokenType.Conditional, value: `[${string}]` } | { type: VDFTokenType.ControlCharacter, value: "{" | "}" }) & { range: VDFRange, exteriorRange: VDFRange }
