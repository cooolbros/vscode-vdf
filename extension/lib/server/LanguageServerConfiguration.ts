import type { languageClientsInfo } from "$lib/languageClientsInfo"
import type { DocumentSymbol } from "vscode-languageserver"

export interface LanguageServerConfiguration<T extends DocumentSymbol[]> {
	servers?: (keyof typeof languageClientsInfo)[]
	parseDocumentSymbols(str: string, ...args: any): T
	defaultDocumentSymbols(): T
}
