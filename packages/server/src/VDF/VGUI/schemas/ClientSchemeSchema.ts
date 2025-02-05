import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { CompletionItemKind } from "vscode-languageserver"
import { VGUIAssetType, type DefinitionMatcher, type DefinitionResult, type VDFTextDocumentSchema } from "../../VDFTextDocument"

class SchemeDefinitionMatcher implements DefinitionMatcher {

	constructor(private readonly type: string, private readonly children: boolean) { }
	match(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]): DefinitionResult | undefined {
		if (path.length == 2 && (documentSymbol.children != undefined) == this.children && path[0].key.toLowerCase() == "Scheme".toLowerCase() && path[1].key.toLowerCase() == this.type.toLowerCase()) {
			return {
				key: documentSymbol.key,
				keyRange: documentSymbol.nameRange,
			}
		}
	}
}

export const ClientSchemeSchema: VDFTextDocumentSchema = {
	keys: {},
	values: {
		backgroundtype: {
			kind: 13,
			values: [
				"0",
				"2",
			]
		},
		bordertype: {
			kind: 13,
			values: [
				"image",
				"scalable_image",
			]
		}
	},
	definitionReferences: [
		{
			type: Symbol.for("color"),
			definition: new SchemeDefinitionMatcher("Colors", false),
			reference: {
				keys: new Set("color"),
				match: null
			},
			toCompletionItem: (definition) => {
				if (!definition.detail) {
					return undefined
				}

				try {
					const [r, g, b] = definition.detail.split(/\s+/).map(parseFloat)
					return { kind: CompletionItemKind.Color, documentation: `rgb(${r},${g},${b})` }
				}
				catch (_) {
					return undefined
				}
			},
		},
		{
			type: Symbol.for("color"),
			definition: new SchemeDefinitionMatcher("BaseSettings", false),
			reference: {
				keys: new Set("color"),
				match: null
			},
			toCompletionItem: (definition) => {
				if (!definition.detail) {
					return undefined
				}

				try {
					const [r, g, b] = definition.detail.split(/\s+/).map(parseFloat)
					return { kind: CompletionItemKind.Color, documentation: `rgb(${r},${g},${b})` }
				}
				catch (_) {
					return undefined
				}
			},
		},
		{
			type: Symbol.for("border"),
			definition: new SchemeDefinitionMatcher("Borders", true),
			reference: {
				keys: new Set(),
				match: null
			},
			toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
		},
		{
			type: Symbol.for("font"),
			definition: new SchemeDefinitionMatcher("Fonts", true),
			reference: {
				keys: new Set(),
				match: null
			},
			toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
		}
	],
	files: [
		{
			name: "font file",
			parentKeys: [
				"Scheme".toLowerCase(),
				"CustomFontFiles".toLowerCase()
			],
			keys: new Set([
				"font",
			]),
			folder: "",
			extensionsPattern: ".*tf",
			resolveBaseName: (value, withExtension) => value,
		},
		{
			name: "bitmap font file",
			parentKeys: [
				"Scheme".toLowerCase(),
				"BitmapFontFiles".toLowerCase()
			],
			keys: new Set([
				"Buttons".toLowerCase(),
				"ButtonsSC".toLowerCase(),
			]),
			folder: "",
			extensionsPattern: null,
			resolveBaseName: (value, withExtension) => value,
		},
		{
			name: "image",
			parentKeys: [],
			keys: new Set([
				"image",
			]),
			folder: "materials/vgui",
			extensionsPattern: ".vmt",
			resolveBaseName: (value, withExtension) => withExtension(".vmt"),
			asset: VGUIAssetType.Image
		},
	],
	colours: {
		keys: {
			include: null,
			exclude: new Set(["inset"])
		},
		colours: [
			{
				pattern: /^\s?\d+\s+\d+\s+\d+\s+\d+\s?$/,
				parse(value) {
					const colour = value.trim().split(/\s+/)
					return {
						red: parseInt(colour[0]) / 255,
						green: parseInt(colour[1]) / 255,
						blue: parseInt(colour[2]) / 255,
						alpha: parseInt(colour[3]) / 255
					}
				},
				stringify(colour) {
					return `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`
				},
			}
		]
	},
	completion: {
		root: [],
		typeKey: null,
		defaultType: null
	}
}
