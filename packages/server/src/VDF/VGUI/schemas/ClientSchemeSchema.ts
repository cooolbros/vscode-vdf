import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { ColourInformationStringify, DocumentLinkData } from "../../../TextDocumentBase"
import { KeyDistinct, VGUIAssetType, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

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

export const ClientSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {

	const next = document.diagnostics.next({
		"color": document.diagnostics.string(document.diagnostics.reference(Symbol.for("color")))
	})

	const getDiagnostics = document.diagnostics.header(
		document.diagnostics.documentSymbols(
			document.uri.basename().toLowerCase() == "clientscheme.res" ? KeyDistinct.First : KeyDistinct.None,
			{
				"Colors": [next],
				"BaseSettings": [next],
				"BitmapFontFiles": [next],
				"Fonts": [next],
				"Borders": [next],
				"CustomFontFiles": [next],
			},
			(documentSymbol, path, context, unknown) => [unknown()],
		),
		false
	)

	return {
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
		getDefinitionReferences({ documentSymbols }) {
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
							text: document.getText(documentSymbol.range),
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
				reference: {
					keys: new Set(),
					match: null
				},
				toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
			},
			{
				type: Symbol.for("font"),
				reference: {
					keys: new Set(),
					match: null
				},
				toCompletionItem: () => ({ kind: CompletionItemKind.Snippet })
			}
		],
		getDiagnostics: getDiagnostics,
		getLinks: ({ documentSymbols, resolve }) => {
			const links: DocumentLinkData[] = []

			documentSymbols.forEach((documentSymbols) => {
				if (!documentSymbols.children) {
					return
				}

				SchemeForEach(documentSymbols.children, {
					"BitmapFontFiles": (documentSymbol) => {
						if (documentSymbol.detail != undefined && documentSymbol.detail.trim() != "") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(documentSymbol.detail!)))
								}
							})
						}
					},
					"Borders": (documentSymbol) => {
						if (documentSymbol.children) {
							links.push(
								...documentSymbol
									.children
									.values()
									.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "image" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
									.map((documentSymbol) => {
										return {
											range: documentSymbol.detailRange!,
											data: {
												resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`materials/vgui/${documentSymbol.detail!}`, ".vmt")))
											}
										}
									})
							)
						}
					},
					"CustomFontFiles": (documentSymbol) => {
						if (documentSymbol.children) {
							links.push(
								...documentSymbol
									.children
									.values()
									.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "font" && documentSymbol.detail != undefined && documentSymbol.detail.trim() != "")
									.map((documentSymbol) => {
										return {
											range: documentSymbol.detailRange!,
											data: {
												resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(documentSymbol.detail!)))
											}
										}
									})
									.toArray()
							)
						}
						else if (documentSymbol.detail!.trim() != "") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(documentSymbol.detail!)))
								}
							})
						}
					}
				})
			})

			return links
		},
		getColours: ({ documentSymbols }) => {
			const colours: ColourInformationStringify[] = []

			const colour = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail != undefined && /^\s?\d+\s+\d+\s+\d+\s+\d+\s?$/.test(documentSymbol.detail)) {
					const colour = documentSymbol.detail.trim().split(/\s+/)

					const red = parseInt(colour[0]) / 255
					const green = parseInt(colour[1]) / 255
					const blue = parseInt(colour[2]) / 255
					const alpha = parseInt(colour[3]) / 255

					colours.push({
						range: documentSymbol.detailRange!,
						color: { red, green, blue, alpha },
						stringify: (colour) => `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`,
					})
				}
			}

			documentSymbols.forEach((documentSymbols) => {
				if (!documentSymbols.children) {
					return
				}

				SchemeForEach(documentSymbols.children, {
					Colors: colour,
					BaseSettings: colour,
					Borders: (documentSymbol) => {
						if (!documentSymbol.children) {
							return
						}

						documentSymbol.children.forAll((documentSymbol) => {
							if (documentSymbol.key.toLowerCase() == "color") {
								colour(documentSymbol)
							}
						})
					}
				})
			})

			return colours
		},
		files: [
			{
				name: "font file",
				keys: new Set([
					"font",
				]),
				folder: null,
				extension: null,
				extensionsPattern: ".*tf",
				resolveBaseName: (value, withExtension) => value,
			},
			{
				name: "bitmap font file",
				keys: new Set([
					"Buttons".toLowerCase(),
					"ButtonsSC".toLowerCase(),
				]),
				folder: null,
				extension: null,
				extensionsPattern: null,
				resolveBaseName: (value, withExtension) => value,
			},
			{
				name: "image",
				keys: new Set([
					"image",
				]),
				folder: "materials/vgui",
				extension: null,
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
}
