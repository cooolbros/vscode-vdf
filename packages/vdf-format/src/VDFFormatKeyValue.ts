export interface VDFFormatKeyValue {
	key?: string
	value?: string | VDFFormatKeyValue[]
	conditional?: `[${string}]`
	blockComment?: string
	inLineComment?: string
}
