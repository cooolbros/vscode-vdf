import { resolvePath } from "common/resolvePath"
import { VSCodeVDFConfigurationSchema } from "common/VSCodeVDFConfiguration"
import { firstValueFrom, switchMap } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol, type VDFText } from "vdf-documentsymbols"
import { CompletionItemKind, InsertTextFormat, MarkupKind, TextEdit, type InlayHint } from "vscode-languageserver"
import { BaseDocument } from "../../BaseDocument"
import { Collection, type Definition, } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, unknown, type Validate } from "../../DiagnosticFactory"
import type { ColourInformationStringify, PartialDiagnosticCodeActionReference, VDFCompletionList } from "../../TextDocumentBase"
import type { Dependencies, Globals, VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"
import { transform, type VGUITextDocumentDiagnosticsContext } from "./VGUISchema"

interface ClientSchemeDiagnosticsContext extends VGUITextDocumentDiagnosticsContext {
	"font file": Map<string, PartialDiagnosticCodeActionReference[]>
	"bitmap font file": Map<string, PartialDiagnosticCodeActionReference[]>
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

		switch (documentSymbol.key.text.toLowerCase()) {
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

const flags = new Set([
	"italic",
	"underline",
	"strikeout",
	"symbol",
	"antialias",
	"dropshadow",
	"outline",
	"custom",
	"bitmap",
	"rotary",
	"additive",
])

function getBorderType(documentSymbols: VDFDocumentSymbols) {
	const borderType = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "bordertype")?.value?.text.toLowerCase() ?? null
	if (borderType == "image" || borderType == "scalable_image") {
		return borderType
	}
	else {
		return null
	}
}

export const ClientSchemeSchema = (document: VDFTextDocument) => {

	const base = new BaseDocument(document)

	const [global, distinct] = document.uri.basename().toLowerCase() == "clientscheme.res"
		? [null, KeyDistinct.First]
		: ["clientScheme", KeyDistinct.None]

	const d = DiagnosticFactory<ClientSchemeDiagnosticsContext, Dependencies, Globals>(document, distinct, transform)
	const bool = d.string(d.set(["0", "1"]))

	const validateColor = d.string(d.reference(types.colour, global))

	const border = {
		"bordertype": d.string(d.set(["image", "scalable_image"])),
		"backgroundtype": d.string(d.set(["0", "1", "2"])),
	}

	const image = d.file("image", "materials/vgui", ".vmt")
	const borderReference = d.reference(types.border, global)

	const validateImageBorder = d.documentSymbols({
		...border,
		"image": d.string(image.validate),
		"tiled": d.string(d.set(["0", "1"])),
	})

	const validateScalableImageBorder = d.documentSymbols({
		...border,
		"image": d.string(image.validate),
		"color": validateColor,
		"paintfirst": d.string(d.integer()),
		"src_corner_width": d.string(d.integer()),
		"src_corner_height": d.string(d.integer()),
		"draw_corner_width": d.string(d.integer()),
		"draw_corner_height": d.string(d.integer()),
	})

	const validateBorderSide = d.record(d.documentSymbols({
		"color": validateColor,
		"offset": d.string()
	}))

	const validateBaseBorder = d.documentSymbols({
		...border,
		"inset": d.string(),
		"Left": validateBorderSide,
		"Top": validateBorderSide,
		"Right": validateBorderSide,
		"Bottom": validateBorderSide,
	})

	const validateBorder: Validate<VDFDocumentSymbol, ClientSchemeDiagnosticsContext> = (name, value, path, diagnostics, context) => {
		if (value.children != undefined) {
			const borderType = getBorderType(value.children)
			if (borderType == "image") {
				validateImageBorder(name, value, path, diagnostics, context)
			}
			else if (borderType == "scalable_image") {
				validateScalableImageBorder(name, value, path, diagnostics, context)
			}
			else {
				validateBaseBorder(value.key.text, value, path, diagnostics, context)
			}
		}
		else {
			borderReference(name, value.value!, value, path, diagnostics, context)
		}
	}

	const fonts = d.record(
		d.documentSymbols({
			"yres": d.string(),
			"tall": d.string(d.integer()),
			"blur": d.string(d.integer()),
			"scanlines": d.string(d.integer()),
			"scalex": d.string(d.float()),
			"scaley": d.string(d.float()),
			"name": d.string(),
			"weight": d.string(d.integer()),
			...Object.fromEntries(flags.keys().map((flag) => [flag, bool]))
		})
	)

	const customFontFile = d.file("font file", null, undefined)

	const customFontFileBlock = d.documentSymbols({
		"font": d.string(customFontFile.validate),
		"name": d.string(),
		[unknown]: d.documentSymbols({
			"range": d.string()
		})
	})

	const customfontfile: Validate<VDFDocumentSymbol, ClientSchemeDiagnosticsContext> = (name, value, path, diagnostics, context) => {
		if (value.value != undefined) {
			customFontFile.validate(name, value.value, value, path, diagnostics, context)
		}
		else {
			customFontFileBlock(name, value, path, diagnostics, context)
		}
	}

	const bitmapFontFile = d.file("bitmap font file", null, undefined)

	const getDiagnostics = d.header(
		d.documentSymbols({
			"BaseSettings": d.record(d.string()),
			"BitmapFontFiles": d.record(d.string(bitmapFontFile.validate)),
			"Borders": d.record(validateBorder),
			"Colors": d.record(d.string()),
			"CustomFontFiles": d.record(customfontfile),
			"Fonts": d.record(fonts),
		})
	)

	return {
		id: <const>"clientscheme",
		name: <const>"Client Scheme",
		definitionTypes: [
			{
				type: types.colour,
				keys: new Set(["color"]),
			},
			{
				type: types.border,
				keys: new Set(),
			},
			{
				type: types.font,
				keys: new Set(),
			}
		],
		base$: base.base$,
		content$: document.documentSymbols$.pipe(
			base.combineLatestBaseDefinitions((rest) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				function SchemeDefinitionMatcher(type: DefinitionType, children: boolean, completionItem: (documentSymbol: VDFDocumentSymbol, documentation: string) => Definition["completionItem"]) {
					return (documentSymbol: VDFDocumentSymbol) => {
						if ((documentSymbol.children != undefined) == children) {
							const documentation = document.definitions.documentation(documentSymbol)
							definitions.set(null, type, documentSymbol.key.text, {
								uri: document.uri,
								key: documentSymbol.key.text,
								range: documentSymbol.range,
								keyToken: documentSymbol.key,
								nameToken: undefined,
								detail: documentSymbol.value?.text,
								documentation: { kind: MarkupKind.Markdown, value: documentation },
								conditional: documentSymbol.conditional ?? undefined,
								completionItem: completionItem(documentSymbol, documentation)
							})
						}
					}
				}

				function colorDocumentation(documentSymbol: VDFDocumentSymbol, documentation: string) {
					const [r, g, b, a] = documentSymbol.value!.text.split(/\s+/).map((value) => parseFloat(value))
					const colour = [r, g, b].every((value) => !isNaN(value))
						? "\n\n" + `rgb${!isNaN(a) ? "a" : ""}(${r}, ${g}, ${b}${!isNaN(a) ? `, ${a / 255}` : ""})`
						: ""

					return {
						label: documentSymbol.key.text,
						kind: CompletionItemKind.Color,
						documentation: {
							kind: MarkupKind.Markdown,
							value: `${documentation}\n\n${colour}`
						}
					}
				}

				const colorAction = SchemeDefinitionMatcher(types.colour, false, colorDocumentation)
				const fontAction = SchemeDefinitionMatcher(types.font, true, (documentSymbol, documentation) => ({ label: documentSymbol.key.text, kind: CompletionItemKind.Text, documentation: { kind: MarkupKind.Markdown, value: documentation } }))

				SchemeForEach(rest[0]?.children ?? new VDFDocumentSymbols(), {
					Colors: (documentSymbol) => colorAction(documentSymbol),
					BaseSettings: (documentSymbol) => {
						colorAction(documentSymbol)
						if (documentSymbol.value != undefined && types.colour.test(documentSymbol.value.text)) {
							references.set(null, types.colour, documentSymbol.value.text, documentSymbol.value)
						}
					},
					Fonts: (documentSymbol) => {
						fontAction(documentSymbol)
						for (const index of documentSymbol.children ?? []) {
							for (const documentSymbol of index.children ?? []) {
								if (documentSymbol.key.text.toLowerCase() == "name" && documentSymbol.value?.text.trim().length) {
									references.set(null, types.customfontfile, documentSymbol.value.text, documentSymbol.value)
								}
							}
						}
					},
					Borders: (documentSymbol) => {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.border, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: documentSymbol.value?.text,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: {
								label: documentSymbol.key.text,
								kind: CompletionItemKind.Snippet,
								documentation: { kind: MarkupKind.Markdown, value: documentation }
							}
						})

						if (documentSymbol.children) {
							documentSymbol.children.forAll((documentSymbol) => {
								if (documentSymbol.key.text.toLowerCase() == "color" && documentSymbol.value != undefined && types.colour.test(documentSymbol.value.text)) {
									references.set(null, types.colour, documentSymbol.value.text, documentSymbol.value)
								}
							})
						}
						else {
							references.set(null, types.border, documentSymbol.value!.text, documentSymbol.value!)
						}
					},
					CustomFontFiles: (documentSymbol) => {
						if (documentSymbol.children) {
							const name = documentSymbol.children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "name")
							if (name?.value != undefined) {
								const documentation = document.definitions.documentation(documentSymbol)
								definitions.set(null, types.customfontfile, name.value.text, {
									uri: document.uri,
									key: name.value.text,
									range: documentSymbol.range,
									keyToken: documentSymbol.key,
									nameToken: name.value,
									detail: documentSymbol.value?.text,
									documentation: { kind: MarkupKind.Markdown, value: documentation },
									conditional: documentSymbol.conditional ?? undefined,
									completionItem: {
										label: name.value.text,
										kind: CompletionItemKind.TypeParameter,
										documentation: { kind: MarkupKind.Markdown, value: documentation }
									}
								})
							}
						}
					}
				})

				return {
					scopes: scopes,
					definitions: definitions,
					references: references,
				}
			})
		),
		getDiagnostics: (diagnostics, context) => {
			const schemaContext = {
				...context,
				"image": new Map<string, PartialDiagnosticCodeActionReference[]>(),
				"font file": new Map<string, PartialDiagnosticCodeActionReference[]>(),
				"bitmap font file": new Map<string, PartialDiagnosticCodeActionReference[]>(),
			}

			base.getDiagnostics(diagnostics, schemaContext)
			getDiagnostics(diagnostics, schemaContext)

			image.connect(diagnostics, schemaContext)
			customFontFile.connect(diagnostics, schemaContext)
			bitmapFontFile.connect(diagnostics, schemaContext)
		},
		getDocumentLinks: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()
			const documentLinks = base.getDocumentLinks(documentSymbols).toArray()

			SchemeForEach(header, {
				BitmapFontFiles: (documentSymbol) => {
					if (documentSymbol.value?.text.trim().length) {
						documentLinks.push({
							range: documentSymbol.value.range!,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(documentSymbol.value!.text)))).uri
							}
						})
					}
				},
				Borders: (documentSymbol) => {
					if (documentSymbol.children != undefined) {
						documentLinks.push(
							...documentSymbol.children
								.values()
								.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "image" && documentSymbol.value?.text.trim().length)
								.map((documentSymbol) => {
									return {
										range: documentSymbol.value!.range,
										data: {
											resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(`materials/vgui/${documentSymbol.value!.text}`, ".vmt")))).uri
										}
									}
								})
						)
					}
				},
				CustomFontFiles: (documentSymbol) => {
					if (documentSymbol.children != undefined) {
						documentLinks.push(
							...documentSymbol.children
								.values()
								.filter((documentSymbol) => documentSymbol.key.text.toLowerCase() == "font" && documentSymbol.value?.text.trim().length)
								.map((documentSymbol) => {
									return {
										range: documentSymbol.value!.range,
										data: {
											resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(documentSymbol.value!.text)))).uri
										}
									}
								})
						)
					}
					else if (documentSymbol.value?.text.trim().length) {
						documentLinks.push({
							range: documentSymbol.value.range!,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(documentSymbol.value!.text)))).uri
							}
						})
					}
				}
			})

			return documentLinks
		},
		getDocumentColor: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()
			const colours: ColourInformationStringify[] = []

			const colour = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.value != undefined && /^\s?\d+\s+\d+\s+\d+\s+\d+\s?$/.test(documentSymbol.value.text)) {
					const colour = documentSymbol.value.text.trim().split(/\s+/)

					const red = parseInt(colour[0]) / 255
					const green = parseInt(colour[1]) / 255
					const blue = parseInt(colour[2]) / 255
					const alpha = parseInt(colour[3]) / 255

					colours.push({
						range: documentSymbol.value.range!,
						color: { red, green, blue, alpha },
						stringify: (colour) => `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`,
					})
				}
			}

			SchemeForEach(header, {
				Colors: colour,
				BaseSettings: colour,
				Borders: (documentSymbol) => {
					documentSymbol.children?.forAll((documentSymbol) => {
						if (documentSymbol.key.text.toLowerCase() == "color") {
							colour(documentSymbol)
						}
					})
				}
			})

			return colours
		},
		onInlayHint: async (params) => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()
			const inlayHints: InlayHint[] = []

			const font = (documentSymbol: VDFDocumentSymbol) => {
				documentSymbol.children?.forAll((documentSymbol) => {
					if (documentSymbol.key.text.toLowerCase() == "range" && documentSymbol.value?.text.trim().length && params.range.contains(documentSymbol.value.range!)) {
						const label = [
							...documentSymbol
								.value.text
								.matchAll(/\b0x[\da-fA-F]+\b/gi)
								.map((match) => parseInt(match[0]))
								.filter((value) => value > 0)
								.map((value) => value.toString())
						].join(" ")

						if (label.length) {
							inlayHints.push({
								position: documentSymbol.value.range!.end,
								label: label,
								paddingLeft: true,
							})
						}
					}
				})
			}

			SchemeForEach(header, {
				CustomFontFiles: font,
			})

			return inlayHints
		},
		completion: {
			keys: async (params, path, token) => {
				switch (path.length) {
					case 0: {
						return {
							before: base.completionBaseKeys(params, token),
							cls: {
								one: ["Scheme"]
							}
						}
					}
					case 1: {
						return {
							cls: {
								one: [
									"BaseSettings",
									"BitmapFontFiles",
									"Borders",
									"Colors",
									"CustomFontFiles",
									"Fonts",
								]
							}
						}
					}
					case 2: {
						const type = path[1].key.text.toLowerCase()
						switch (type) {
							case "CustomFontFiles".toLowerCase(): {
								return {
									cls: {
										one: [
											(path[1].children!.length + 1).toString()
										]
									}
								}
							}
							default: {
								return null
							}
						}
					}
					case 3: {
						// "Scheme" -> <type> -> <name>
						switch (path[1].key.text.toLowerCase()) {
							case "Colors".toLowerCase(): {
								return null
							}
							case "Borders".toLowerCase(): {
								const children = path[2].children!
								const borderType = getBorderType(children)

								if (borderType == "image") {
									return {
										field: {
											one: [
												"backgroundtype",
												"image",
												"tiled",
											]
										}
									}
								}
								else if (borderType == "scalable_image") {
									return {
										field: {
											one: [
												"backgroundtype",
												"image",
												"color",
												"paintfirst",
												"src_corner_width",
												"src_corner_height",
												"draw_corner_width",
												"draw_corner_height",
											]
										}
									}
								}
								else {
									const range = token != undefined
										? new VDFRange(new VDFPosition(params.position.line, token.start), new VDFPosition(params.position.line, token.end))
										: new VDFRange(params.position)

									return {
										before: [
											{
												label: "bordertype",
												labelDetails: { description: "image" },
												kind: CompletionItemKind.Field,
												textEdit: TextEdit.replace(range, `"bordertype"\t\t"\${1|image,scalable_image|}"`),
												insertTextFormat: InsertTextFormat.Snippet,
											}
										],
										cls: {
											one: [
												"Left",
												"Top",
												"Right",
												"Bottom"
											]
										}
									}
								}
							}
							case "Fonts".toLowerCase(): {
								return {
									cls: {
										one: [
											(path[2].children!.length + 1).toString()
										]
									}
								}
							}
							case "CustomFontFiles".toLowerCase(): {
								return {
									field: {
										one: [
											"font",
											"name",
											...Object.keys(VSCodeVDFConfigurationSchema.shape.popfile.shape.waveStatusPreview.def.innerType.shape.language.def.innerType.enum)
										]
									}
								}
							}
							default: {
								return null
							}
						}
					}
					case 4: {
						// "Scheme" -> <type> -> <name> -> <key>
						switch (path[1].key.text.toLowerCase()) {
							case "Colors".toLowerCase(): {
								return null
							}
							case "Borders".toLowerCase(): {
								const key = path[3].key.text.toLowerCase()
								if (key == "Left".toLowerCase() || key == "Top".toLowerCase() || key == "Right".toLowerCase() || key == "Bottom".toLowerCase()) {
									return {
										cls: {
											one: [
												(path[3].children!.length + 1).toString()
											]
										}
									}
								}
								else {
									return null
								}
							}
							case "Fonts".toLowerCase(): {
								return {
									field: {
										one: [
											"name",
											"tall",
											"weight",
											"yres",
											"blur",
											"scanlines",
											"scalex",
											"scaley",
											...flags.keys()
										],
										values: Object.fromEntries(flags.keys().map((flag) => [flag.toLowerCase(), ["1", "0"]]))
									}
								}
							}
							case "CustomFontFiles".toLowerCase(): {
								return {
									field: {
										one: [
											"range"
										]
									}
								}
							}
							default: {
								return null
							}
						}
					}
					case 5: {
						// "Scheme" -> <type> -> <name> -> <key> -> <key>
						switch (path[1].key.text.toLowerCase()) {
							case "Borders".toLowerCase(): {
								// "Scheme" -> <type> -> <name> -> <side> -> <index>
								return {
									field: {
										one: [
											"color",
											"offset"
										]
									}
								}
							}
							default: {
								return null
							}
						}
					}
					default: {
						return null
					}
				}
			},
			values: async (params, path, key, token) => {
				key = key.toLowerCase()

				const definitions = async (type: DefinitionType): Promise<VDFCompletionList> => {
					const definitions = (await firstValueFrom(
						global == null
							? document.definitions$
							: document.data$.pipe(switchMap((data) => data.globals.get("clientScheme").definitions$))
					)).ofType(null, type)

					return {
						token: token,
						length: definitions.size,
						items: definitions
							.values()
							.map((definition) => definition[0].completionItem)
					}
				}

				const colours = async () => {
					return await definitions(types.colour)
				}

				const borders = async (): Promise<VDFCompletionList> => {
					return await definitions(types.border)
				}

				const customFontFiles = async () => {
					return await definitions(types.customfontfile)
				}

				const images = async () => {
					return await params.files({
						folder: "materials/vgui",
						params: params,
						token: token,
						basenamePattern: "*.vmt",
						map: "name",
						image: true
					})
				}

				switch (path.length) {
					case 0: {
						if (key == "#base") {
							return await base.completionBaseValues(params, token)
						}
						else {
							return null
						}
					}
					case 1: {
						// "Scheme" -> ""
						return null
					}
					case 2: {
						// "Scheme" -> <type> -> ""
						switch (path[1].key.text.toLowerCase()) {
							case "Borders".toLowerCase(): {
								return await borders()
							}
							default: {
								return null
							}
						}
					}
					case 3: {
						// "Scheme" -> <type> -> <name> -> ""
						switch (path[1].key.text.toLowerCase()) {
							case "Colors".toLowerCase(): {
								return null
							}
							case "Borders".toLowerCase(): {
								switch (key.toLowerCase()) {
									case "bordertype": {
										return {
											length: 2,
											items: [
												{ label: "image", kind: CompletionItemKind.EnumMember },
												{ label: "scalable_image", kind: CompletionItemKind.EnumMember },
											]
										}
									}
									case "backgroundtype": {
										return {
											length: 3,
											items: [
												{ label: "0", kind: CompletionItemKind.EnumMember },
												{ label: "1", kind: CompletionItemKind.EnumMember },
												{ label: "2", kind: CompletionItemKind.EnumMember },
											]
										}
									}
									default: {
										return null
									}
								}
							}
							default: {
								return null
							}
						}
					}
					case 4: {
						// "Scheme" -> <type> -> <name> -> ? -> ""
						switch (path[1].key.text.toLowerCase()) {
							case "Borders".toLowerCase(): {
								const borderType = getBorderType(path[2].children!)
								if (borderType == "image") {
									switch (key) {
										case "image": {
											return await images()
										}
										case "tiled": {
											return params.bits()
										}
										default: {
											return null
										}
									}
								}
								else if (borderType == "scalable_image") {
									switch (key) {
										case "image": {
											return await images()
										}
										case "color": {
											return await colours()
										}
										case "paintfirst": {
											return params.bits()
										}
										default: {
											return null
										}
									}
								}
								else {
									switch (key) {
										case "inset": {
											return {
												length: 1,
												items: [
													{ label: "0 0 0 0", kind: CompletionItemKind.Operator }
												],
											}
										}
										default: {
											return null
										}
									}
								}
							}
							case "Fonts".toLowerCase(): {
								if (flags.has(key)) {
									return params.bits()
								}

								switch (key) {
									case "name": {
										return await customFontFiles()
									}
									case "weight": {
										return {
											length: 8,
											items: Array.from({ length: 8 }, (element, index) => ({ label: ((index + 1) * 100).toString(), kind: CompletionItemKind.Unit }))
										}
									}
									default: {
										return null
									}
								}
							}
							default: {
								return null
							}
						}
					}
					case 5: {
						switch (path[1].key.text.toLowerCase()) {
							case "Borders".toLowerCase(): {
								switch (key) {
									case "color": {
										return await colours()
									}
									case "offset": {
										return {
											length: 1,
											items: [
												{ label: "0 0", kind: CompletionItemKind.Operator }
											],
										}
									}
									default: {
										return null
									}
								}
							}
							default: {
								return null
							}
						}
					}
					default: {
						return null
					}
				}
			},
		},
	} satisfies VDFTextDocumentSchema
}
