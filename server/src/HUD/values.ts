import { CompletionItem, CompletionItemKind } from "vscode-languageserver-types"

export const statichudKeyBitValues = [
	"visible",
	"enabled",
	"paintbackground",
	"paintborder",
	"use_proportional_insets",
	"proportionaltoparent",
]

const pinValues: CompletionItem[] = [
	{ label: "PIN_TOPLEFT", kind: CompletionItemKind.Enum },
	{ label: "PIN_TOPRIGHT", kind: CompletionItemKind.Enum },
	{ label: "PIN_BOTTOMLEFT", kind: CompletionItemKind.Enum },
	{ label: "PIN_BOTTOMRIGHT", kind: CompletionItemKind.Enum },
	{ label: "PIN_CENTER_TOP", kind: CompletionItemKind.Enum },
	{ label: "PIN_CENTER_RIGHT", kind: CompletionItemKind.Enum },
	{ label: "PIN_CENTER_BOTTOM", kind: CompletionItemKind.Enum },
	{ label: "PIN_CENTER_LEFT", kind: CompletionItemKind.Enum },
]

export const statichudKeyValues: Record<string, CompletionItem[]> = {
	"textalignment": [
		{ label: "center", kind: CompletionItemKind.Enum },
		{ label: "east", kind: CompletionItemKind.Enum },
		{ label: "north-east", kind: CompletionItemKind.Enum },
		{ label: "north-west", kind: CompletionItemKind.Enum },
		{ label: "north", kind: CompletionItemKind.Enum },
		{ label: "south-east", kind: CompletionItemKind.Enum },
		{ label: "south-west", kind: CompletionItemKind.Enum },
		{ label: "south", kind: CompletionItemKind.Enum },
		{ label: "west", kind: CompletionItemKind.Enum },
	],
	"paintbackgroundtype": [
		{ label: "0", kind: CompletionItemKind.Enum },
		{ label: "1", kind: CompletionItemKind.Enum },
		{ label: "2", kind: CompletionItemKind.Enum },
		{ label: "3", kind: CompletionItemKind.Enum },
	],
	"pin_corner_to_sibling": pinValues,
	"pin_to_sibling_corner": pinValues
}