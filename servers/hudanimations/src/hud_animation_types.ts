import { CompletionItemKind } from "vscode-languageserver/node";

const animationCommandKind = CompletionItemKind.Keyword
export const animationCommands = [
	{ label: "Animate", kind: animationCommandKind },
	{ label: "RunEvent", kind: animationCommandKind },
	{ label: "StopEvent", kind: animationCommandKind },
	{ label: "SetVisible", kind: animationCommandKind },
	{ label: "FireCommand", kind: animationCommandKind },
	{ label: "RunEventChild", kind: animationCommandKind },
	{ label: "SetInputEnabled", kind: animationCommandKind },
	{ label: "PlaySound", kind: animationCommandKind },
	{ label: "StopPanelAnimations", kind: animationCommandKind },
]

const commonPropertiesKind = CompletionItemKind.Field
export const commonProperties = [
	{ label: "Alpha", kind: commonPropertiesKind },
	{ label: "Ammo2Color", kind: commonPropertiesKind },
	{ label: "BgColor", kind: commonPropertiesKind },
	{ label: "Blur", kind: commonPropertiesKind },
	{ label: "FgColor", kind: commonPropertiesKind },
	{ label: "HintSize", kind: commonPropertiesKind },
	{ label: "icon_expand", kind: commonPropertiesKind },
	{ label: "ItemColor", kind: commonPropertiesKind },
	{ label: "MenuColor", kind: commonPropertiesKind },
	{ label: "Position", kind: commonPropertiesKind },
	{ label: "PulseAmount", kind: commonPropertiesKind },
	{ label: "SelectionAlpha", kind: commonPropertiesKind },
	{ label: "Size", kind: commonPropertiesKind },
	{ label: "tall", kind: commonPropertiesKind },
	{ label: "TextScan", kind: commonPropertiesKind },
	{ label: "wide", kind: commonPropertiesKind },
	{ label: "xpos", kind: commonPropertiesKind },
	{ label: "ypos", kind: commonPropertiesKind }
]

const interpolatorKind = CompletionItemKind.Property
export const interpolators = [
	{ label: "Linear", kind: interpolatorKind },
	{ label: "Accel", kind: interpolatorKind },
	{ label: "Deaccel", kind: interpolatorKind },
	{ label: "Spline", kind: interpolatorKind },
	{ label: "Pulse", kind: interpolatorKind },
	{ label: "Flicker", kind: interpolatorKind },
	{ label: "Gain", kind: interpolatorKind },
	{ label: "Bias", kind: interpolatorKind },
]