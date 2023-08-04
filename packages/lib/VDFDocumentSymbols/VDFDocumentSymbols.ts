import type { Position } from "vscode-languageserver"
import type { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	public forAll(callback: (documentSymbol: VDFDocumentSymbol, objectPath: Lowercase<string>[]) => void): void {
		const objectPath: Lowercase<string>[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): void => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					objectPath.push(<Lowercase<string>>documentSymbol.key.toLowerCase())
					iterateDocumentSymbols(documentSymbol.children)
					objectPath.pop()
				}
				callback(documentSymbol, objectPath)
			}
		}
		iterateDocumentSymbols(this)
	}

	public findRecursive(callback: (documentSymbol: VDFDocumentSymbol, objectPath: string[]) => boolean): VDFDocumentSymbol | undefined {
		const objectPath: string[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): VDFDocumentSymbol | undefined => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					objectPath.push(documentSymbol.key.toLowerCase())
					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result != undefined) {
						return result
					}
					objectPath.pop()
				}

				if (callback(documentSymbol, objectPath)) {
					return documentSymbol
				}
			}
		}
		return iterateDocumentSymbols(this)
	}

	public getDocumentSymbolAtPosition(position: Position): VDFDocumentSymbol | undefined {
		return this.findRecursive(documentSymbol => documentSymbol.range.contains(position))
	}
}
