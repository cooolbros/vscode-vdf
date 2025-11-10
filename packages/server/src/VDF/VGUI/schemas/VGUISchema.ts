import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import { DiagnosticSeverity, InlayHint, TextEdit } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { DiagnosticCodeActions, DocumentLinkData } from "../../../TextDocumentBase"
import { VGUIAssetType, type RefineString, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import clientscheme from "../clientscheme.json"
import keys from "../keys.json"
import values from "../values.json"
import { VGUITextDocument } from "../VGUITextDocument"

const elements = [
	"pin_to_sibling",
	"navUp",
	"navDown",
	"navLeft",
	"navRight",
	"navToRelay",
]

const strings = [
	"button_token",
	"desc_token",
	"labelText",
	"title",
	"tooltip",
]

const distinct = new Set([
	"autoResize".toLowerCase(),
	"ControlName".toLowerCase(),
	"enabled",
	"fieldName".toLowerCase(),
	"pinCorner".toLowerCase(),
	"tall",
	"visible",
	"wide",
	"xpos",
	"ypos",
	"zpos",
])

const images = new Set([
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
])

const sounds = new Set([
	"sound_armed",
	"sound_depressed",
	"sound_released"
])

const enumIndexKeys = new Map([
	["autoresize", "autoResize"],
	["pin_corner_to_sibling", "pin_corner_to_sibling"],
	["pin_to_sibling_corner", "pin_to_sibling_corner"],
	["pincorner", "pinCorner"],
])

const definitionReferences = new Map([
	[Symbol.for("element"), { keys: new Set(elements) }],
	[Symbol.for("color"), { keys: new Set(clientscheme.Colors), match: (value: string) => !/\d+\s+\d+\s+\d+\s+\d+/.test(value) /* Exclude colour literals */ }],
	[Symbol.for("border"), { keys: new Set(clientscheme.Borders) }],
	[Symbol.for("font"), { keys: new Set(clientscheme.Fonts) }],
	[Symbol.for("string"), { keys: new Set(strings.map((string) => string.toLowerCase())), match: (value: string) => value[0] == "#", toDefinition: (value: string) => value.substring(1), toReference: (name: string) => `#${name}` }],
])

export const VGUISchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {

	const { set, reference, file } = document.diagnostics

	const match = (type: symbol, match: (detail: string) => string | null): RefineString<VGUITextDocument> => {
		const refine = document.diagnostics.reference(type)
		return (name, detail, detailRange, documentSymbol, path, context) => {
			let value = match(detail)
			return value != null
				? refine(name, value, detailRange, documentSymbol, path, context)
				: []
		}
	}

	const element = reference(Symbol.for("element"))

	const token = match(Symbol.for("string"), (detail) => detail[0] == "#" ? detail.substring("#".length) : null)

	const color = match(
		Symbol.for("color"),
		(detail) => !/\d+\s+\d+\s+\d+\s+\d+/.test(detail) ? detail : null
	)

	const border = reference(Symbol.for("border"))
	const font = reference(Symbol.for("font"))

	const image = file("image", "materials/vgui", ".vmt")

	const next = document.diagnostics.next({
		...Object.fromEntries(Object.entries(values).map(([key, value]) => <const>[key, set("enumIndex" in value && value.enumIndex ? [...value.values, ...value.values.map((_, index) => index.toString())] : value.values, "fix" in value ? value.fix : undefined)])),
		...Object.fromEntries(clientscheme.Colors.map((value) => <const>[value, color])),
		...Object.fromEntries(clientscheme.Borders.map((value) => <const>[value, border])),
		...Object.fromEntries(clientscheme.Fonts.map((value) => <const>[value, font])),
		...Object.fromEntries(elements.map((value) => <const>[value, element])),
		...Object.fromEntries(strings.map((value) => <const>[value, token])),
		...Object.fromEntries(images.values().map((value) => <const>[value, image]))
	})

	const getDiagnostics = document.diagnostics.header(
		(key, documentSymbol, path, context) => {
			const diagnostics: DiagnosticCodeActions = []
			if (documentSymbol.children == undefined) {
				diagnostics.push({
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-type",
					source: "vgui",
					message: "Invalid header type.",
				})
				return diagnostics
			}

			documentSymbol.children.forEach((documentSymbol) => {
				documentSymbol.children?.forAll((documentSymbol, path) => {
					const key = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())
					diagnostics.push(...next(key, documentSymbol, path, context))

					// Distinct Keys
					if (distinct.has(key)) {
						const children = path.at(-1)!.children!
						const first = children.find((i) => i.key.toLowerCase() == documentSymbol.key.toLowerCase() && i.conditional?.toLowerCase() == documentSymbol.conditional?.toLowerCase())!
						if (first != documentSymbol) {
							diagnostics.push({
								range: documentSymbol.nameRange,
								severity: DiagnosticSeverity.Warning,
								code: "duplicate-key",
								source: "vgui",
								message: `Duplicate ${first.key}`,
								relatedInformation: [
									{
										location: {
											uri: document.uri.toString(),
											range: first.nameRange
										},
										message: `${first.key} is declared here.`
									}
								],
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return {
											title: `Remove duplicate ${documentSymbol.key}`,
											edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
										}
									}
								}
							})
						}
					}

					// fieldName
					if (key == "fieldName".toLowerCase()) {
						const element = path.at(-1)!.key
						if (documentSymbol.detail == undefined) {
							diagnostics.push({
								range: documentSymbol.childrenRange!,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-fieldname",
								source: "vgui",
								message: `Invalid fieldName type.`,
							})
						}
						else if (documentSymbol.detail != element) {
							diagnostics.push({
								range: documentSymbol.detailRange!,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-fieldname",
								source: "vgui",
								message: `fieldName '${documentSymbol.detail}' does not match element name. Expected '${element}'.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return {
											title: `Change fieldName to '${element}'`,
											edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.detailRange!, element)),
										}
									},
								}
							})
						}
					}
				}, [documentSymbol])
			})

			return diagnostics
		},
		true
	)

	return {
		keys: keys,
		values: values,
		getDefinitionReferences({ documentSymbols }) {
			const element = Symbol.for("element")

			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			documentSymbols.forAll((documentSymbol) => {
				if (documentSymbol.detail != undefined) {
					const referenceKey = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())
					for (const [type, reference] of definitionReferences) {
						if (reference?.keys.has(referenceKey) && (reference.match != null ? reference.match(documentSymbol.detail) : true)) {
							references.set(null, type, reference.toDefinition ? reference.toDefinition(documentSymbol.detail) : documentSymbol.detail, documentSymbol.detailRange!)
						}
					}
					return
				}

				definitions.set(null, element, documentSymbol.key, {
					uri: document.uri,
					key: documentSymbol.key,
					range: documentSymbol.range,
					keyRange: documentSymbol.nameRange,
					nameRange: documentSymbol.children!.find((i) => i.key.toLowerCase() == "fieldName".toLowerCase() && i.detail != undefined)?.detailRange,
					detail: documentSymbol.detail,
					documentation: document.definitions.documentation(documentSymbol),
					conditional: documentSymbol.conditional ?? undefined,
				})
			})

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: definitionReferences,
		getDiagnostics: getDiagnostics,
		getLinks: ({ documentSymbols, resolve }) => {
			const links: DocumentLinkData[] = []
			documentSymbols.forEach((documentSymbol) => {
				documentSymbol.children?.forAll((documentSymbol) => {
					if (documentSymbol.detail == undefined) {
						return
					}

					const key = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())

					if (images.has(key) && documentSymbol.detail.trim() != "") {
						links.push({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`materials/vgui/${documentSymbol.detail}`, ".vmt")))
							}
						})
						return
					}

					if (sounds.has(key) && documentSymbol.detail.trim() != "") {
						links.push({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`sound/${documentSymbol.detail}`)))
							}
						})
						return
					}

					if (key == "modelname" && documentSymbol.detail.trim() != "") {
						links.push({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(documentSymbol.detail!, ".mdl")))
							}
						})
						return
					}
				})
			})

			return links
		},
		getColours: ({ next }) => {
			return next((colours, documentSymbol) => {
				if (documentSymbol.detail != undefined && /^\s*?\d+\s+\d+\s+\d+\s+\d+\s*?$/.test(documentSymbol.detail)) {
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
			})
		},
		getInlayHints: async ({ dependencies, documentSymbols }) => {
			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			return documentSymbols.reduce(
				(inlayHints, documentSymbol) => {
					if (!documentSymbol.children) {
						return inlayHints
					}

					inlayHints.push(
						...documentSymbol.children.reduceRecursive(
							<InlayHint[]>[],
							(inlayHints, documentSymbol, path) => {
								if (documentSymbol.detail == undefined) {
									return inlayHints
								}

								const key = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())

								const name = enumIndexKeys.get(key)
								if (name != undefined) {
									const data = dependencies.schema.values[name]
									if (data.enumIndex) {
										const index = parseInt(documentSymbol.detail)
										if (!isNaN(index) && index >= 0 && index < data.values.length) {
											inlayHints.push({
												position: documentSymbol.detailRange!.end,
												label: data.values[index],
												textEdits: [TextEdit.replace(documentSymbol.detailRange!, data.values[index])],
												paddingLeft: true,
											})
										}
									}
									return inlayHints
								}

								if (strings.find((string) => string.toLowerCase() == key) != undefined && documentSymbol.detail[0] == "#") {
									const definitions = definitionReferences.definitions.get(null, Symbol.for("string"), documentSymbol.detail.substring(1))
									if (definitions?.[0].detail) {
										inlayHints.push({
											position: documentSymbol.detailRange!.end,
											label: definitions[0].detail,
											paddingLeft: true,
										})
									}
								}

								if ((key == "wide" || key == "tall") && /^o\d?\.?\d+$/.test(documentSymbol.detail)) {
									const detail = path.at(-1)?.children?.find(
										key == "wide"
											? (documentSymbol) => documentSymbol.key.toLowerCase() == "tall"
											: (documentSymbol) => documentSymbol.key.toLowerCase() == "wide"
									)?.detail

									if (detail != undefined) {
										if (/^p\d?\.?\d+$/.test(detail)) {
											const label = parseFloat(detail.substring(1)) * parseFloat(documentSymbol.detail!.substring(1))
											if (!isNaN(label)) {
												inlayHints.push({
													position: documentSymbol.detailRange!.end,
													label: `p${Number.isInteger(label) ? label : label.toFixed(2)}`,
													paddingLeft: true,
												})
											}
										}
										else if (/^\d+$/.test(detail)) {
											const label = parseFloat(detail) * parseFloat(documentSymbol.detail!.substring(1))
											if (!isNaN(label)) {
												inlayHints.push({
													position: documentSymbol.detailRange!.end,
													label: `${Number.isInteger(label) ? label : label.toFixed(2)}`,
													paddingLeft: true,
												})
											}
										}
									}
								}

								return inlayHints
							}
						)
					)

					return inlayHints
				},
				<InlayHint[]>[]
			)
		},
		completion: {
			root: [],
			typeKey: "ControlName".toLowerCase(),
			defaultType: "Panel".toLowerCase(),
			files: [
				{
					keys: images,
					folder: "materials/vgui",
					extensionsPattern: ".vmt",
					toCompletionItem: (name, type, withoutExtension) => ({ insertText: withoutExtension() }),
					asset: VGUIAssetType.Image
				},
				{
					keys: sounds,
					folder: "sound",
					extensionsPattern: null,
				},
				{
					keys: new Set(["modelname"]),
					folder: null,
					extensionsPattern: ".mdl",
				}
			],
		}
	}
}
