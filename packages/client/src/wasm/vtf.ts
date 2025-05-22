import type { ExtensionContext } from "vscode"
import init from "vtf-png"
import { readFile } from "./readFile"

// @ts-ignore
import vtf_png_bg_url from "vtf-png/pkg/vtf_png_bg.wasm?url"

let VTFPNGWASM: import("vtf-png").InitOutput

export async function initVTFPNG(context: ExtensionContext) {
	VTFPNGWASM ??= await init(readFile(context, vtf_png_bg_url))
}
