import type { VDFRange } from "./VDFRange"

export const enum VDFTokenType {
	String,
	OpeningBrace,
	ClosingBrace,
	Conditional,
	Comment,
	NewLine
}

export type VDFToken = (
	| { type: VDFTokenType.String, value: string }
	| { type: VDFTokenType.OpeningBrace, value: "{" }
	| { type: VDFTokenType.ClosingBrace, value: "}" }
	| { type: VDFTokenType.Conditional, value: `[${string}]` }
	| { type: VDFTokenType.Comment, value: string }
	| { type: VDFTokenType.NewLine, value: "\n" }
) & { range: VDFRange, exteriorRange: VDFRange }
