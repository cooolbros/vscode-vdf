import { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	public forAll(callback: (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => void, path: VDFDocumentSymbol[] = []): void {
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): void => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					path.push(documentSymbol)
					iterateDocumentSymbols(documentSymbol.children)
					path.pop()
				}
				callback(documentSymbol, path)
			}
		}
		iterateDocumentSymbols(this)
	}

	public findRecursive(callback: (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => boolean): { documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[] } | undefined {
		const path: VDFDocumentSymbol[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): { documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[] } | undefined => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					path.push(documentSymbol)
					const result = iterateDocumentSymbols(documentSymbol.children)
					if (result != undefined) {
						return result
					}
					path.pop()
				}

				if (callback(documentSymbol, path)) {
					return { documentSymbol, path }
				}
			}
		}
		return iterateDocumentSymbols(this)
	}

	public reduceRecursive<T>(initialValue: T, callbackfn: (previousValue: T, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => T): T {
		let result = initialValue
		this.forAll((documentSymbol, path) => {
			result = callbackfn(result, documentSymbol, path)
		})
		return result
	}
}
