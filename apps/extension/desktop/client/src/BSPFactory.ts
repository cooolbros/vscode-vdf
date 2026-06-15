import { BSP } from "bsp"
import { initBSP } from "client/wasm/bsp"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import vscode from "vscode"

export class BSPFactory extends RefCountAsyncDisposableFactory<Uri, BSP> {
	constructor(private readonly context: vscode.ExtensionContext) {
		super(
			(uri) => uri.toString(),
			async (uri) => {
				const [buffer] = await Promise.all([
					vscode.workspace.fs.readFile(uri),
					initBSP(this.context)
				])

				return new BSP(buffer)
			}
		)
	}
}
