export interface VDFFormatDocumentSymbol {
	key?: string
	value?: string | VDFFormatDocumentSymbol[]
	conditional?: `[${string}]`
	blockComment?: string
	inLineComment?: string
}
