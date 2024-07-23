import type { IPosition } from "vdf"
import type { HUDAnimationsEventDocumentSymbol, HUDAnimationsStatementDocumentSymbol } from "./HUDAnimationsDocumentSymbol"

export class HUDAnimationsDocumentSymbols extends Array<HUDAnimationsEventDocumentSymbol> {

	public forAllStatements(callback: (documentSymbol: HUDAnimationsStatementDocumentSymbol) => void): void {
		for (const event of this) {
			for (const statement of event.children) {
				callback(statement)
			}
		}
	}

	public getHUDAnimationStatementAtPosition(position: IPosition): HUDAnimationsStatementDocumentSymbol | undefined {
		for (const event of this) {
			for (const statement of event.children) {
				if (statement.range.contains(position)) {
					return statement
				}
			}
		}
		return undefined
	}
}

export class HUDAnimationsStatementDocumentSymbols extends Array<HUDAnimationsStatementDocumentSymbol> {
}
