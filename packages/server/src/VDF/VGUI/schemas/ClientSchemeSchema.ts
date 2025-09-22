import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { VGUIAssetType, type DefinitionMatcher, type DefinitionResult, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

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

type SchemeAction = (documentSymbol: VDFDocumentSymbol) => void

interface SchemeActions {
	Colors: SchemeAction
	BaseSettings: SchemeAction
	BitmapFontFiles: SchemeAction
	Fonts: SchemeAction
	Borders: SchemeAction
	CustomFontFiles: SchemeAction
}

function SchemeForEach(documentSymbols: VDFDocumentSymbols, callbacks: Partial<SchemeActions>) {
	for (const documentSymbol of documentSymbols) {
		if (documentSymbol.children == undefined) {
			continue
		}

		switch (documentSymbol.key.toLowerCase()) {
			case "Colors".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.Colors?.(documentSymbol))
				break
			case "BaseSettings".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.BaseSettings?.(documentSymbol))
				break
			case "BitmapFontFiles".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.BitmapFontFiles?.(documentSymbol))
				break
			case "Fonts".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.Fonts?.(documentSymbol))
				break
			case "Borders".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.Borders?.(documentSymbol))
				break
			case "CustomFontFiles".toLowerCase():
				documentSymbol.children.forEach((documentSymbol) => callbacks.CustomFontFiles?.(documentSymbol))
				break
		}
	}
}

export const ClientSchemeSchema: VDFTextDocumentSchema<VGUITextDocument> = {
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
	getDefinitionReferences({ document, documentSymbols }) {
		const scopes = new Map<symbol, Map<number, VDFRange>>()
		const definitions = new Collection<Definition>()
		const references = new Collection<VDFRange>()

		function SchemeDefinitionMatcher(type: symbol, children: boolean) {
			return (documentSymbol: VDFDocumentSymbol) => {
				if ((documentSymbol.children != undefined) == children) {
					definitions.set(null, type, documentSymbol.key, {
						uri: document.uri,
						key: documentSymbol.key,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: undefined,
						detail: documentSymbol.detail,
						documentation: documentSymbol.documentation,
						conditional: documentSymbol.conditional ?? undefined,
					})
				}
			}
		}

		const color = SchemeDefinitionMatcher(Symbol.for("color"), false)
		const font = SchemeDefinitionMatcher(Symbol.for("font"), true)
		const border = SchemeDefinitionMatcher(Symbol.for("border"), true)

		SchemeForEach(documentSymbols, {
			Colors: (documentSymbol) => color(documentSymbol),
			BaseSettings: (documentSymbol) => {
				color(documentSymbol)
				if (documentSymbol.detail != undefined) {
					references.set(null, Symbol.for("color"), documentSymbol.detail, documentSymbol.detailRange!)
				}
			},
			Fonts: (documentSymbol) => font(documentSymbol),
			Borders: (documentSymbol) => {
				border(documentSymbol)
				documentSymbol.children?.forAll((documentSymbol) => {
					if (documentSymbol.key.toLowerCase() == "color" && documentSymbol.detail != undefined) {
						references.set(null, Symbol.for("color"), documentSymbol.detail, documentSymbol.detailRange!)
					}
				})
			}
		})

		return {
			scopes: scopes,
			definitions: definitions,
			references: references,
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
