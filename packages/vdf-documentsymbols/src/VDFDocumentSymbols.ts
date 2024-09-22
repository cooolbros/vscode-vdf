import type { IPosition } from "vdf/src/VDFPosition"
import { z } from "zod"
import { VDFDocumentSymbol } from "./VDFDocumentSymbol"

export class VDFDocumentSymbols extends Array<VDFDocumentSymbol> {

	public static readonly schema = z.lazy(() => VDFDocumentSymbol.schema.array().transform((arg) => new VDFDocumentSymbols(...arg)))

	public forAll(callback: (documentSymbol: VDFDocumentSymbol, path: string[]) => void): void {
		const path: string[] = []
		const iterateDocumentSymbols = (documentSymbols: VDFDocumentSymbols): void => {
			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children) {
					path.push(documentSymbol.key.toLowerCase())
					iterateDocumentSymbols(documentSymbol.children)
					path.pop()
				}
				callback(documentSymbol, path)
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

	public getDocumentSymbolAtPosition(position: IPosition): VDFDocumentSymbol | undefined {
		return this.findRecursive(documentSymbol => documentSymbol.range.contains(position))
	}

	public reduceRecursive<T>(initialValue: T, callbackfn: (previousValue: T, documentSymbol: VDFDocumentSymbol, path: string[]) => T): T {
		let result = initialValue
		this.forAll((documentSymbol, path) => {
			result = callbackfn(result, documentSymbol, path)
		})
		return result
	}

	public toJSON() {
		return this.values().map((documentSymbol) => documentSymbol.toJSON()).toArray()
	}
}
