import type { VDFRange } from "vdf"

export interface VDFText {
	readonly text: string
	readonly range: VDFRange
	readonly tokenRange: VDFRange
	readonly quoted: boolean
}
