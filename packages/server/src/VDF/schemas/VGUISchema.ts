import { resolvePath } from "common/resolvePath"
import { combineLatest, firstValueFrom, switchMap } from "rxjs"
import type { VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFText } from "vdf-documentsymbols"
import { CompletionItemKind, DiagnosticSeverity, MarkupKind, TextEdit, type InlayHint } from "vscode-languageserver"
import { BaseDocument } from "../../BaseDocument"
import { Collection, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, type DiagnosticsContext } from "../../DiagnosticFactory"
import { TextDocumentBase, type ColourInformationStringify, type PartialDiagnosticCodeActionReference, type VDFCompletionItem } from "../../TextDocumentBase"
import clientscheme from "../clientscheme.json"
import keys from "../keys.json"
import values from "../values.json"
import type { Dependencies, Globals, VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

export interface VGUITextDocumentDiagnosticsContext extends DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols> {
	image: Map<string, PartialDiagnosticCodeActionReference[]>
}

export const transform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "").toLowerCase()

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

const definitionTypes = [
	{ type: types.element, global: null, keys: new Set(elements) },
	{ type: types.colour, global: "clientScheme", keys: new Set(clientscheme.Colors) },
	{ type: types.border, global: "clientScheme", keys: new Set(clientscheme.Borders) },
	{ type: types.font, global: "clientScheme", keys: new Set(clientscheme.Fonts) },
	{ type: types.string, global: "languageTokens", keys: new Set(strings.map((string) => string.toLowerCase())) }
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

const fixes = {
	textAlignment: {
		"center-east": "east",
		"center-west": "west",
		"centereast": "east",
		"centerwest": "west",
		"left": "west",
		"northeast": "north-east",
		"northwest": "north-west",
		"right": "east",
		"southeast": "south-east",
		"southwest": "south-west"
	}
}

export const VGUISchema = (document: VDFTextDocument) => {

	const base = new BaseDocument(document)

	const d = DiagnosticFactory<VGUITextDocumentDiagnosticsContext, Dependencies, Globals>(document, KeyDistinct.First, transform)

	const element = d.reference(types.element, null)
	const token = d.reference(types.string, "languageTokens")
	const image = d.file("image", "materials/vgui", ".vmt")
	const color = d.reference(types.colour, "clientScheme")
	const border = d.reference(types.border, "clientScheme")
	const font = d.reference(types.font, "clientScheme")

	const next = d.next({
		...Object.fromEntries(Object.entries(values).map(([key, value]) => <const>[key, d.set(enumIndexKeys.has(key) ? [...value, ...value.map((_, index) => index.toString())] : value, ((key): key is keyof typeof fixes => key in fixes)(key) ? fixes[key] : undefined)])),
		...Object.fromEntries(elements.map((value) => <const>[value, element])),
		...Object.fromEntries(strings.map((value) => <const>[value, token])),
		...Object.fromEntries(images.values().map((value) => <const>[value, image.validate])),
		...Object.fromEntries(clientscheme.Colors.map((value) => <const>[value, color])),
		...Object.fromEntries(clientscheme.Borders.map((value) => <const>[value, border])),
		...Object.fromEntries(clientscheme.Fonts.map((value) => <const>[value, font])),
	})

	const getDiagnostics = d.header(
		d.record(
			(key, value, path, diagnostics, context) => {
				value.children?.forAll((documentSymbol, path) => {
					const key = transform(documentSymbol.key.text)
					next(key, documentSymbol, path, diagnostics, context)

					// Distinct Keys
					if (distinct.has(key)) {
						const children = path.at(-1)!.children!
						d.distinct(KeyDistinct.First, documentSymbol, children, diagnostics)
					}

					// fieldName
					if (key == "fieldName".toLowerCase()) {
						const element = path.at(-1)!.key.text
						if (documentSymbol.value == undefined) {
							diagnostics.push({
								range: documentSymbol.childrenRange!,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-fieldname",
								source: "vgui",
								message: `Invalid fieldName type.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return {
											title: `Change fieldName to '${element}'`,
											edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.childrenRange!, `"${element}"`)),
										}
									}
								}
							})
						}
						else if (documentSymbol.value.text != element) {
							diagnostics.push({
								range: documentSymbol.value.range!,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-fieldname",
								source: "vgui",
								message: `fieldName '${documentSymbol.value.text}' does not match element name. Expected '${element}'.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return {
											title: `Change fieldName to '${element}'`,
											edit: createDocumentWorkspaceEdit(TextDocumentBase.replaceTokenTextEdit(documentSymbol.value!, element)),
										}
									}
								}
							})
						}
					}
				}, [value])
			}
		)
	)

	return {
		id: <const>"vgui",
		name: <const>"VGUI",
		definitionTypes: definitionTypes,
		base$: base.base$,
		content$: document.documentSymbols$.pipe(
			base.combineLatestBaseDefinitions((rest) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				rest[0]?.children?.forAll((documentSymbol) => {
					if (documentSymbol.children != undefined) {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.element, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: documentSymbol.children!.find((i) => i.key.text.toLowerCase() == "fieldName".toLowerCase() && i.value != undefined)?.value,
							detail: documentSymbol.value?.text,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: {
								label: documentSymbol.key.text,
								kind: CompletionItemKind.Variable,
								documentation: { kind: MarkupKind.Markdown, value: documentation },
							}
						})
					}
					else {
						const key = transform(documentSymbol.key.text)
						const value = documentSymbol.value!

						for (const { type, keys } of definitionTypes) {
							if (keys.has(key) && type.test(value.text)) {
								references.set(null, type, type.toDefinition(value.text), value)
							}
						}
					}
				})

				return {
					scopes: scopes,
					definitions: definitions,
					references: references,
				}
			}),
		),
		getDiagnostics: (diagnostics, context) => {
			const schemaContext = { ...context, image: new Map<string, PartialDiagnosticCodeActionReference[]>() }
			base.getDiagnostics(diagnostics, schemaContext)
			getDiagnostics(diagnostics, schemaContext)
			image.connect(diagnostics, schemaContext)
		},
		getDocumentLinks: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()

			return header.reduceRecursive(
				base.getDocumentLinks(documentSymbols).toArray(),
				(documentLinks, documentSymbol) => {
					if (!documentSymbol.value?.text.trim().length) {
						return documentLinks
					}

					const key = transform(documentSymbol.key.text)

					if (images.has(key)) {
						documentLinks.push({
							range: documentSymbol.value.range,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(`materials/vgui/${documentSymbol.value!.text}`, ".vmt")))).uri
							}
						})
						return documentLinks
					}

					if (sounds.has(key)) {
						documentLinks.push({
							range: documentSymbol.value.range,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(`sound/${documentSymbol.value!.text}`)))).uri
							}
						})
						return documentLinks
					}

					if (key == "modelname") {
						documentLinks.push({
							range: documentSymbol.value.range,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(documentSymbol.value!.text, ".mdl")))).uri
							}
						})
						return documentLinks
					}

					return documentLinks
				}
			)
		},
		getDocumentColor: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()

			return header.reduceRecursive(
				<ColourInformationStringify[]>[],
				(documentColours, documentSymbol) => {
					if (documentSymbol.value != undefined && /^\s*?\d+\s+\d+\s+\d+\s+\d+\s*?$/.test(documentSymbol.value.text)) {
						const colour = documentSymbol.value.text.trim().split(/\s+/)

						const red = parseInt(colour[0]) / 255
						const green = parseInt(colour[1]) / 255
						const blue = parseInt(colour[2]) / 255
						const alpha = parseInt(colour[3]) / 255

						documentColours.push({
							range: documentSymbol.value.range,
							color: { red, green, blue, alpha },
							stringify: (colour) => `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`,
						})
					}

					return documentColours
				}
			)
		},
		onInlayHint: async (params) => {
			const { documentSymbols, definitions } = await firstValueFrom(combineLatest({
				documentSymbols: document.documentSymbols$,
				definitions: document.data$.pipe(switchMap((data) => data.globals.get("languageTokens").definitions$)),
			}))

			const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children ?? new VDFDocumentSymbols()
			return header.reduceRecursive(
				<InlayHint[]>[],
				(inlayHints, documentSymbol, path) => {
					if (!documentSymbol.value?.text.trim().length || !params.range.contains(documentSymbol.value.range)) {
						return inlayHints
					}

					const key = transform(documentSymbol.key.text)

					if (strings.some((string) => string.toLowerCase() == key) && types.string.test(documentSymbol.value.text)) {
						const definition = definitions.get(null, types.string, types.string.toDefinition(documentSymbol.value.text))?.[0]
						if (definition?.detail) {
							inlayHints.push({
								position: documentSymbol.value.range.end,
								label: [definition.inlayHintLabel!],
								paddingLeft: true,
							})
						}
					}

					if ((key == "wide" || key == "tall") && /^o\d?\.?\d+$/.test(documentSymbol.value.text)) {
						const value = path.at(-1)?.children?.find(
							key == "wide"
								? (documentSymbol) => documentSymbol.key.text.toLowerCase() == "tall"
								: (documentSymbol) => documentSymbol.key.text.toLowerCase() == "wide"
						)?.value?.text

						if (value != undefined) {
							if (/^p\d?\.?\d+$/.test(value)) {
								const label = parseFloat(value.substring(1)) * parseFloat(documentSymbol.value!.text.substring(1))
								if (!isNaN(label)) {
									inlayHints.push({
										position: documentSymbol.value.range.end,
										label: `p${Number.isInteger(label) ? label : label.toFixed(2)}`,
										paddingLeft: true,
									})
								}
							}
							else if (/^\d+$/.test(value)) {
								const label = parseFloat(value) * parseFloat(documentSymbol.value!.text.substring(1))
								if (!isNaN(label)) {
									inlayHints.push({
										position: documentSymbol.value.range.end,
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
		},
		completion: {
			keys: async (params, path, token) => {
				if (path.length == 0) {
					return {
						before: base.completionBaseKeys(params, token),
						cls: {
							one: [document.relativePath?.path ?? document.uri.basename()]
						}
					}
				}

				const controlName = path
					.toReversed()
					.values()
					.map((documentSymbol) => documentSymbol.children?.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "ControlName".toLowerCase())?.value?.text.toLowerCase())
					.filter((controlName) => controlName != undefined)
					.find((controlName) => ((_type): _type is keyof typeof keys => controlName in keys)(controlName))
					?? <const>"panel"

				const include = (k: keyof typeof keys): string[] => {
					const value = keys[k]
					return [
						...("extends" in value ? include(<keyof typeof keys>value.extends) : []),
						...("value" in value ? value.value.field.one : []),
					]
				}

				const one = include(controlName)

				return {
					field: {
						one: one,
						values: values,
					}
				}
			},
			values: async (params, path, key, token) => {
				key = key.toLowerCase()
				if (key == "#base") {
					return await base.completionBaseValues(params, token)
				}

				key = transform(key)

				// Static
				const data = Object.entries((values)).find(([k, _values]) => k.toLowerCase() == key)?.[1]
				if (data != undefined) {
					return {
						token: token,
						length: data.length,
						items: data.map((value, index) => ({
							label: value,
							labelDetails: { description: enumIndexKeys.has(key) ? index.toString() : undefined },
							kind: CompletionItemKind.EnumMember,
						}) satisfies VDFCompletionItem)
					}
				}

				// References
				for (const { type, global, keys } of definitionTypes) {
					if (keys.has(key)) {
						const definitions = (await firstValueFrom(global == null ? document.definitions$ : document.data$.pipe(switchMap((data) => data.globals.get(global).definitions$)))).ofType(null, type)
						return {
							token: token,
							length: definitions.size,
							items: definitions
								.values()
								.map((definition) => definition[0].completionItem)
						}
					}
				}

				// Images
				if (images.has(key)) {
					return await params.files({
						folder: "materials/vgui",
						params: params,
						token: token,
						basenamePattern: "*.vmt",
						map: "name",
						image: true
					})
				}

				// Sound
				if (sounds.has(key)) {
					return await params.files({
						folder: "sound",
						params: params,
						token: token,
					})
				}

				// modelname
				if (key == "modelname") {
					return await params.files({
						folder: "",
						params: params,
						token: token,
						basenamePattern: "*.mdl",
					})
				}

				return null
			},
		}
	} satisfies VDFTextDocumentSchema
}
