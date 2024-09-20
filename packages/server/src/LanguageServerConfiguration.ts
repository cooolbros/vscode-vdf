import type { LanguageNames } from "utils/types/LanguageNames"
import type { DocumentSymbol } from "vscode-languageserver"

export interface LanguageServerConfiguration<T extends DocumentSymbol[]> {
	servers: Set<keyof LanguageNames>
	parseDocumentSymbols(uri: string, str: string, ...args: any): T
	defaultDocumentSymbols(): T
}
