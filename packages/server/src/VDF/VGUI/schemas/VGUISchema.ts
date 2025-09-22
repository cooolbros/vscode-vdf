import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { VGUIAssetType, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import clientscheme from "../clientscheme.json"
import keys from "../keys.json"
import values from "../values.json"
import { VGUITextDocument } from "../VGUITextDocument"

export const VGUISchema: VDFTextDocumentSchema<VGUITextDocument> = {
	keys: keys,
	values: values,
	getDefinitionReferences({ document, documentSymbols }) {
		const element = Symbol.for("element")

		const scopes = new Map<symbol, Map<number, VDFRange>>()
		const definitions = new Collection<Definition>()
		const references = new Collection<VDFRange>()

		for (const documentSymbol of documentSymbols) {
			if (documentSymbol.children != undefined) {
				definitions.set(null, element, documentSymbol.key, {
					uri: document.uri,
					key: documentSymbol.key,
					range: documentSymbol.range,
					keyRange: documentSymbol.nameRange,
					nameRange: documentSymbol.children.find((i) => i.key.toLowerCase() == "fieldName".toLowerCase() && i.detail != undefined)?.detailRange,
					detail: documentSymbol.detail,
					documentation: documentSymbol.documentation,
					conditional: documentSymbol.conditional ?? undefined,
				})

				documentSymbol.children.forAll((documentSymbol) => {
					if (documentSymbol.detail != undefined) {
						const referenceKey = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())
						for (const { type, reference } of this.definitionReferences) {
							if (reference?.keys.has(referenceKey) && (reference.match != null ? reference.match(documentSymbol.detail) : true)) {
								references.set(null, type, reference.toDefinition ? reference.toDefinition(documentSymbol.detail) : documentSymbol.detail, documentSymbol.detailRange!)
							}
						}
					}
				})
			}
		}

		return {
			scopes: scopes,
			definitions: definitions,
			references: references,
		}
	},
	definitionReferences: [
		{
			type: Symbol.for("element"),
			definition: {
				match: (documentSymbol, path) => {
					if (documentSymbol.children != undefined && path.length != 0) {
						return {
							key: documentSymbol.key,
							keyRange: documentSymbol.nameRange,
							nameRange: documentSymbol.children?.find((i) => i.key.toLowerCase() == "fieldName".toLowerCase() && i.detail != undefined)?.detailRange
						}
					}
				}
			},
			reference: {
				keys: new Set([
					"pin_to_sibling",
					"navUp".toLowerCase(),
					"navDown".toLowerCase(),
					"navLeft".toLowerCase(),
					"navRight".toLowerCase(),
					"navToRelay".toLowerCase(),
				]),
				match: null
			}
		},
		{
			type: Symbol.for("color"),
			definition: null,
			reference: {
				keys: new Set(clientscheme.Colors),
				match: (string) => !/\d+\s+\d+\s+\d+\s+\d+/.test(string) // Exclude colour literals
			},
			toCompletionItem: (definition) => {
				if (!definition.detail) {
					return undefined
				}

				try {
					const [r, g, b] = definition.detail.split(/\s+/).map(parseFloat)
					return { kind: CompletionItemKind.Color, documentation: `rgb(${r},${g},${b})` }
				}
				catch (error) {
					console.error(error)
					return undefined
				}
			},
		},
		{
			type: Symbol.for("border"),
			definition: null,
			reference: {
				keys: new Set(clientscheme.Borders),
				match: null
			}
		},
		{
			type: Symbol.for("font"),
			definition: null,
			reference: {
				keys: new Set(clientscheme.Fonts),
				match: null
			}
		},
		{
			type: Symbol.for("string"),
			definition: null,
			reference: {
				keys: new Set([
					"button_token",
					"desc_token",
					"labelText".toLowerCase(),
					"title",
					"tooltip",
				]),
				match: (string) => /^#/.test(string),
				toDefinition: (string) => string.substring("#".length)
			},
			toReference: (value) => `#${value}`,
			toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, labelDetails: { description: definition.detail }, insertText: `#${definition.key}` })
		}
	],
	files: [
		{
			name: "image",
			parentKeys: [],
			keys: new Set([
				"activeimage",
				"blueimage",
				"image_armed",
				"image_default",
				"image_name",
				"image_selected",
				"image",
				"inactiveimage",
				"redimage",
				...Array.from({ length: 3 }, (_, index) => `teambg_${index + 1}`)
			]),
			folder: "materials/vgui",
			extensionsPattern: ".vmt",
			resolveBaseName: (value, withExtension) => withExtension(".vmt"),
			toCompletionItem: (name, type, withoutExtension) => ({ insertText: withoutExtension() }),
			asset: VGUIAssetType.Image
		},
		{
			name: "sound",
			parentKeys: [],
			keys: new Set([
				"sound_armed",
				"sound_depressed",
				"sound_released"
			]),
			folder: "sound",
			extensionsPattern: null,
			resolveBaseName: (value, withExtension) => value,
		},
		{
			name: "model",
			parentKeys: [],
			keys: new Set(["modelname"]),
			folder: "",
			extensionsPattern: ".mdl",
			resolveBaseName: (value, withExtension) => withExtension(".mdl"),
		}
	],
	colours: {
		keys: null,
		colours: [
			{
				pattern: /^\s*?\d+\s+\d+\s+\d+\s+\d+\s*?$/,
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
		typeKey: "ControlName".toLowerCase(),
		defaultType: "Panel".toLowerCase()
	}
}
