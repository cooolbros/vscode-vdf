import { CompletionItem, CompletionItemKind } from "vscode-languageserver-types"

export const genericHudTypes: CompletionItem[] = [
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
]

const labelProperties: CompletionItem[] = [
	{ label: "labelText", kind: CompletionItemKind.Field },
	{ label: "font", kind: CompletionItemKind.Field },
	{ label: "textAlignment", kind: CompletionItemKind.Field },
	{ label: "textinsetx", kind: CompletionItemKind.Field },
	{ label: "textinsety", kind: CompletionItemKind.Field },
	{ label: "use_proportional_insets", kind: CompletionItemKind.Field },
	{ label: "dulltext", kind: CompletionItemKind.Field },
	{ label: "brighttext", kind: CompletionItemKind.Field },
]

const imageProperties: CompletionItem[] = [
	{ label: "image", kind: CompletionItemKind.Field },
	{ label: "scaleImage", kind: CompletionItemKind.Field },
	{ label: "src_corner_height", kind: CompletionItemKind.Field },
	{ label: "src_corner_width", kind: CompletionItemKind.Field },
	{ label: "draw_corner_width", kind: CompletionItemKind.Field },
	{ label: "draw_corner_height", kind: CompletionItemKind.Field },
]

export const hudTypes: Record<string, CompletionItem[]> = {
	editablepanel: [
		{ label: "border", kind: CompletionItemKind.Field },
		{ label: "paintbackgroundtype", kind: CompletionItemKind.Field }
	],
	label: [
		...labelProperties,
		{ label: "fgcolor_override", kind: CompletionItemKind.Field }
	],
	cexlabel: [
		...labelProperties,
		{ label: "fgcolor", kind: CompletionItemKind.Field }
	],
	button: [
		...labelProperties,
		{ label: "fgcolor_override", kind: CompletionItemKind.Field },
		{ label: "command", kind: CompletionItemKind.Field },
	],
	cexbutton: [
		...labelProperties,
		{ label: "fgcolor", kind: CompletionItemKind.Field },
		{ label: "command", kind: CompletionItemKind.Field },
	],
	imagepanel: [
		...imageProperties
	],
	ctfimagepanel: [
		...imageProperties,
		{ label: "teambg_1", kind: CompletionItemKind.Field },
		{ label: "teambg_2", kind: CompletionItemKind.Field },
		{ label: "teambg_3", kind: CompletionItemKind.Field },
	]
}
