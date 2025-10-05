import { firstValueFrom } from "rxjs"
import type { VDFRange } from "vdf"
import { CompletionItemKind, DiagnosticSeverity, TextEdit } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { DiagnosticCodeActions, DocumentLinkData } from "../../../TextDocumentBase"
import { VGUIAssetType, type VDFTextDocumentSchema } from "../../VDFTextDocument"
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

export const VGUISchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {

	const match = (type: symbol, match: (detail: string) => string | null) => {
		const refine = document.diagnostics.reference(type)
		return document.diagnostics.string((name, detail, detailRange, path, context) => {
			let value = match(detail)
			return value != null
				? refine(name, value, detailRange, path, context)
				: []
		})
	}

	const { string, set, reference } = document.diagnostics

	const element = string(reference(Symbol.for("element")))

	const token = match(Symbol.for("string"), (detail) => detail[0] == "#" ? detail.substring("#".length) : null)

	const color = match(
		Symbol.for("color"),
		(detail) => !/\d+\s+\d+\s+\d+\s+\d+/.test(detail) ? detail : null
	)

	const border = string(document.diagnostics.reference(Symbol.for("border")))
	const font = string(document.diagnostics.reference(Symbol.for("font")))

	const next = document.diagnostics.next({
		...Object.fromEntries(Object.entries(values).map(([key, value]) => <const>[key, set("enumIndex" in value && value.enumIndex ? [...value.values, ...value.values.map((_, index) => index.toString())] : value.values, "fix" in value ? value.fix : undefined)])),
		...Object.fromEntries(clientscheme.Colors.map((value) => <const>[value, color])),
		...Object.fromEntries(clientscheme.Borders.map((value) => <const>[value, border])),
		...Object.fromEntries(clientscheme.Fonts.map((value) => <const>[value, font])),
		...Object.fromEntries(elements.map((value) => <const>[value, element])),
		...Object.fromEntries(strings.map((value) => <const>[value, token])),
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

			for (const documentSymbol of documentSymbols) {
				if (documentSymbol.children != undefined) {
					definitions.set(null, element, documentSymbol.key, {
						uri: document.uri,
						key: documentSymbol.key,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: documentSymbol.children.find((i) => i.key.toLowerCase() == "fieldName".toLowerCase() && i.detail != undefined)?.detailRange,
						detail: documentSymbol.detail,
						documentation: document.definitions.documentation(documentSymbol),
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
				reference: {
					keys: new Set(elements),
					match: null
				}
			},
			{
				type: Symbol.for("color"),
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
				reference: {
					keys: new Set(clientscheme.Borders),
					match: null
				}
			},
			{
				type: Symbol.for("font"),
				reference: {
					keys: new Set(clientscheme.Fonts),
					match: null
				}
			},
			{
				type: Symbol.for("string"),
				reference: {
					keys: new Set(strings),
					match: (string) => /^#/.test(string),
					toDefinition: (string) => string.substring("#".length)
				},
				toReference: (value) => `#${value}`,
				toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, labelDetails: { description: definition.detail }, insertText: `#${definition.key}` })
			}
		],
		getDiagnostics: getDiagnostics,
		getLinks: ({ documentSymbols, resolve }) => {
			const links: DocumentLinkData[] = []
			documentSymbols.forEach((documentSymbol) => {
				documentSymbol.children?.forAll((documentSymbol) => {
					const key = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())

					if (images.has(key) && documentSymbol.detail?.trim() != "") {
						links.push({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`materials/vgui/${documentSymbol.detail}`, ".vmt")))
							}
						})
						return
					}

					if (sounds.has(key) && documentSymbol.detail?.trim() != "") {
						links.push({
							range: documentSymbol.detailRange!,
							data: {
								resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`sound/${documentSymbol.detail}`)))
							}
						})
						return
					}

					if (key == "modelname" && documentSymbol.detail?.trim() != "") {
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
		files: [
			{
				name: "image",
				keys: images,
				folder: "materials/vgui",
				extension: ".vmt",
				extensionsPattern: ".vmt",
				resolveBaseName: (value, withExtension) => withExtension(".vmt"),
				toCompletionItem: (name, type, withoutExtension) => ({ insertText: withoutExtension() }),
				asset: VGUIAssetType.Image
			},
			{
				name: "sound",
				keys: sounds,
				folder: "sound",
				extension: null,
				extensionsPattern: null,
				resolveBaseName: (value, withExtension) => value,
			},
			{
				name: "model",
				keys: new Set(["modelname"]),
				folder: null,
				extension: null,
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
}
