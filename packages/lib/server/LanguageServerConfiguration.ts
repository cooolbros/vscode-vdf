import type { DocumentSymbol } from "vscode-languageserver"
import type { languageClientsInfo } from "../languageClientsInfo"

export interface LanguageServerConfiguration<T extends DocumentSymbol[]> {
	servers?: (keyof typeof languageClientsInfo)[]
	parseDocumentSymbols(uri: string, str: string, ...args: any): T
	defaultDocumentSymbols(): T
}
