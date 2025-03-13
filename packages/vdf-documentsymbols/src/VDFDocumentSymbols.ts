import type { IPosition } from "vdf/src/VDFPosition"
import { z } from "zod"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/species
	public static get [Symbol.species]() {
		return Array
	}

	public static readonly schema = z.lazy(() => VDFDocumentSymbol.schema.array().transform((arg) => new VDFDocumentSymbols(...arg)))

	public forAll(callback: (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => void): void {
		const path: VDFDocumentSymbol[] = []
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

	public findRecursive(callback: (documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => boolean): VDFDocumentSymbol | undefined {
		const path: VDFDocumentSymbol[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): VDFDocumentSymbol | undefined => {
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
					return documentSymbol
				}
			}
		}
		return iterateDocumentSymbols(this)
	}

	public getDocumentSymbolAtPosition(position: IPosition): VDFDocumentSymbol | undefined {
		return this.findRecursive((documentSymbol) => documentSymbol.range.contains(position))
	}

	public reduceRecursive<T>(initialValue: T, callbackfn: (previousValue: T, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]) => T): T {
		let result = initialValue
		this.forAll((documentSymbol, path) => {
			result = callbackfn(result, documentSymbol, path)
		})
		return result
	}

	public toJSON() {
		return this.map((documentSymbol) => documentSymbol.toJSON())
	}
}
