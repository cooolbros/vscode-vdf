import type { Position } from "vscode-languageserver"
import type { HUDAnimationsEventDocumentSymbol, HUDAnimationsStatementDocumentSymbol } from "./HUDAnimationsDocumentSymbol"

export class HUDAnimationsDocumentSymbols extends Array<HUDAnimationsEventDocumentSymbol> {

	public forAllStatements(callback: (documentSymbol: HUDAnimationsStatementDocumentSymbol) => void): void {
		for (const event of this) {
			for (const statement of event.children) {
				callback(statement)
			}
		}
	}

	public getHUDAnimationStatementAtPosition(position: Position): HUDAnimationsStatementDocumentSymbol | undefined {
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
