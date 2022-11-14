import type { Position } from "vscode-languageserver"
import type { VDFDocumentSymbol } from "./VDFDocumentSymbol"

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

		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): ReturnType<VDFDocumentSymbols["findRecursive"]> => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result != undefined) {
						return result
					}
				}

				if (callback(documentSymbol)) {
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
