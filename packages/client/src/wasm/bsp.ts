import init from "bsp"
import type { ExtensionContext } from "vscode"
import { readFile } from "./readFile"

// @ts-ignore
import bsp_bg_url from "bsp/pkg/bsp_bg.wasm?url"

let BSPWASM: import("bsp").InitOutput

export async function initBSP(context: ExtensionContext) {
	BSPWASM ??= await init(readFile(context, bsp_bg_url))
}
