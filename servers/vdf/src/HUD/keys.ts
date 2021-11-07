import { CompletionItem, CompletionItemKind } from "vscode-languageserver-types"

export namespace hudTypes {
	export const genericHudTypes: CompletionItem[] = [
		{ label: "ControlName", kind: CompletionItemKind.Field },
		{ label: "fieldName", kind: CompletionItemKind.Field },
		{ label: "xpos", kind: CompletionItemKind.Field },
		{ label: "ypos", kind: CompletionItemKind.Field },
		{ label: "zpos", kind: CompletionItemKind.Field },
		{ label: "wide", kind: CompletionItemKind.Field },
		{ label: "tall", kind: CompletionItemKind.Field },
		{ label: "autoResize", kind: CompletionItemKind.Field },
		{ label: "pinCorner", kind: CompletionItemKind.Field },
		{ label: "visible", kind: CompletionItemKind.Field },
		{ label: "enabled", kind: CompletionItemKind.Field },
		{ label: "bgcolor_override", kind: CompletionItemKind.Field },
		{ label: "paintBackground", kind: CompletionItemKind.Field },
		{ label: "paintBorder", kind: CompletionItemKind.Field },
		{ label: "mouseinputenabled", kind: CompletionItemKind.Field },
		{ label: "pin_to_sibling", kind: CompletionItemKind.Field },
		{ label: "pin_corner_to_sibling", kind: CompletionItemKind.Field },
		{ label: "pin_to_sibling_corner", kind: CompletionItemKind.Field },
		{ label: "proportionaltoparent", kind: CompletionItemKind.Field },
	]
	const labelProperties: CompletionItem[] = [
		{ label: "auto_wide_tocontents", kind: CompletionItemKind.Field },
		{ label: "auto_tall_tocontents", kind: CompletionItemKind.Field },
		{ label: "dulltext", kind: CompletionItemKind.Field },
		{ label: "brighttext", kind: CompletionItemKind.Field },
		{ label: "labelText", kind: CompletionItemKind.Field },
		{ label: "font", kind: CompletionItemKind.Field },
		{ label: "textAlignment", kind: CompletionItemKind.Field },
		{ label: "textinsetx", kind: CompletionItemKind.Field },
		{ label: "textinsety", kind: CompletionItemKind.Field },
		{ label: "use_proportional_insets", kind: CompletionItemKind.Field },
		{ label: "wrap", kind: CompletionItemKind.Field },
		{ label: "centerwrap", kind: CompletionItemKind.Field },
	]
	const buttonProperties: CompletionItem[] = [
		{ label: "sound_armed", kind: CompletionItemKind.Field },
		{ label: "sound_depressed", kind: CompletionItemKind.Field },
		{ label: "sound_released", kind: CompletionItemKind.Field },
		{ label: "command", kind: CompletionItemKind.Field },
		{ label: "default", kind: CompletionItemKind.Field },
	]
	const imageProperties: CompletionItem[] = [
		{ label: "image", kind: CompletionItemKind.Field },
		{ label: "fillcolor", kind: CompletionItemKind.Field },
		{ label: "drawcolor", kind: CompletionItemKind.Field },
		{ label: "scaleImage", kind: CompletionItemKind.Field },
		{ label: "tileImage", kind: CompletionItemKind.Field },
		{ label: "src_corner_height", kind: CompletionItemKind.Field },
		{ label: "src_corner_width", kind: CompletionItemKind.Field },
		{ label: "draw_corner_width", kind: CompletionItemKind.Field },
		{ label: "draw_corner_height", kind: CompletionItemKind.Field },
	]
	export const editablepanel: CompletionItem[] = [
		{ label: "border", kind: CompletionItemKind.Field },
		{ label: "paintbackgroundtype", kind: CompletionItemKind.Field }
	]
	export const label: CompletionItem[] = [
		...labelProperties,
		{ label: "fgcolor_override", kind: CompletionItemKind.Field }
	]
	export const cexlabel: CompletionItem[] = [
		...labelProperties,
		{ label: "fgcolor", kind: CompletionItemKind.Field }
	]
	export const button: CompletionItem[] = [
		...labelProperties,
		{ label: "fgcolor_override", kind: CompletionItemKind.Field },
		...buttonProperties
	]
	export const cexbutton: CompletionItem[] = [
		...labelProperties,
		{ label: "fgcolor", kind: CompletionItemKind.Field },
		...buttonProperties
	]
	export const imagepanel: CompletionItem[] = [
		...imageProperties
	]
	export const ctfimagepanel: CompletionItem[] = [
		...imageProperties,
		{ label: "teambg_1", kind: CompletionItemKind.Field },
		{ label: "teambg_2", kind: CompletionItemKind.Field },
		{ label: "teambg_3", kind: CompletionItemKind.Field },
	]
}


// export const hudTypes: Record<string, CompletionItem[]> = {


// }
