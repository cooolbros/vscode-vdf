import type { languageNames } from "utils/languageNames"
import type { DocumentSymbol } from "vscode-languageserver"

export interface LanguageServerConfiguration<T extends DocumentSymbol[]> {
	servers?: (keyof typeof languageNames)[]
	parseDocumentSymbols(uri: string, str: string, ...args: any): T
	defaultDocumentSymbols(): T
}
