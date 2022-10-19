import { Position } from "vscode-languageserver"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	public forAll(callback: (documentSymbol: VDFDocumentSymbol) => void): void {
		for (const documentSymbol of this) {
			if (documentSymbol.children) {
				documentSymbol.children.forAll(callback)
			}
			callback(documentSymbol)
		}
	}

	public findRecursive(callback: (documentSymbol: VDFDocumentSymbol) => boolean): VDFDocumentSymbol | undefined {
		const documentSymbolsPath: VDFDocumentSymbol[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): ReturnType<VDFDocumentSymbols["findRecursive"]> => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					documentSymbolsPath.push(documentSymbol)
					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result != undefined) {
						return result
					}
					documentSymbolsPath.pop()
				}

				if (callback(documentSymbol)) {
					return documentSymbol
				}
			}
		}

		return iterateDocumentSymbols(this)
	}

	public getDocumentSymbolAtPosition(position: Position): VDFDocumentSymbol | undefined {
		return this.findRecursive(value => value.range.contains(position))
	}
}
