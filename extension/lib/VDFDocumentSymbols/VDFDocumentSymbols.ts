import { Position } from "vscode-languageserver"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	forAll(callback: (documentSymbol: VDFDocumentSymbol) => void) {
		for (const documentSymbol of this) {
			if (documentSymbol.children) {
				documentSymbol.children.forAll(callback)
			}
			callback(documentSymbol)
		}
	}

	findAll(callback: (documentSymbol: VDFDocumentSymbol) => boolean): { result: VDFDocumentSymbol, path: VDFDocumentSymbol[] } | undefined {
		const documentSymbolsPath: VDFDocumentSymbol[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): ReturnType<VDFDocumentSymbols["findAll"]> => {
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
					return {
						result: documentSymbol,
						path: documentSymbolsPath
					}
				}
			}
		}

		return iterateDocumentSymbols(this)
	}

	getDocumentSymbolAtPosition(position: Position): ReturnType<VDFDocumentSymbols["findAll"]> {
		return this.findAll(value => value.range.contains(position))
	}
}
