import { CompletionItemKind } from "vscode-languageserver"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"

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
			definition: {
				directParentKeys: [
					"Scheme".toLowerCase(),
					"Colors".toLowerCase(),
				],
				children: false,
				key: null,
			},
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
			definition: {
				directParentKeys: [
					"Scheme".toLowerCase(),
					"BaseSettings".toLowerCase(),
				],
				children: false,
				key: null,
			},
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
			definition: {
				directParentKeys: [
					"Scheme".toLowerCase(),
					"Borders".toLowerCase(),
				],
				children: true,
				key: null,
			},
			reference: {
				keys: new Set(),
				match: null
			},
			toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
		},
		{
			type: Symbol.for("font"),
			definition: {
				directParentKeys: [
					"Scheme".toLowerCase(),
					"Fonts".toLowerCase(),
				],
				children: true,
				key: null,
			},
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
			folder: null,
			resolve: (name) => name,
			extensionsPattern: ".*tf",
			displayExtensions: true
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
			folder: null,
			resolve: (name) => name,
			extensionsPattern: null,
			displayExtensions: true
		},
		{
			name: "image",
			parentKeys: [],
			keys: new Set([
				"image",
			]),
			folder: "materials/vgui",
			resolve: (name) => name.endsWith(".vmt") ? name : `${name}.vmt`,
			extensionsPattern: ".vmt",
			displayExtensions: false
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
