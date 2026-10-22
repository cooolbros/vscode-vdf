import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { resolvePath } from "common/resolvePath"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { defer, firstValueFrom, map, of, switchMap, type Observable } from "rxjs"
import { VDFIndentation, VDFNewLine, type VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFText } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { formatVDF, type VDFFormatStringifyOptions } from "vdf-format"
import { type DocumentFormattingParams, type InlayHint } from "vscode-languageserver"
import { BaseDocument } from "../BaseDocument"
import { Collection, type Definition } from "../DefinitionReferences"
import { types, type DefinitionType } from "../DefinitionTypes"
import { DiagnosticFactory, KeyDistinct, type DiagnosticsContext } from "../DiagnosticFactory"
import type { ColourInformationStringify, Decoration, DocumentLinkResolve, PartialDiagnosticCodeActionReference, TextDocumentData, TextDocumentDiagnosticsParams, TextDocumentInit, VDFCompletionList, VDFCompletionParams } from "../TextDocumentBase"
import { TextDocumentBase } from "../TextDocumentBase"
import { VDFTextDocument } from "../VDF/VDFTextDocument"
import type { TextDocument } from "../VDFLanguageServer"
import type { GlobalDefinitionReferences, VDFWorkspace } from "../VDFWorkspace"
import keys from "./keys.json"
import values from "./values.json"

const files = new Set([
	"%tooltexture",
	"$baseTexture",
	"$baseTexture2",
	"$blendmodulatetexture",
	"$bottommaterial",
	"$bumpmap",
	"$bumpmap2",
	"$detail",
	"$dudvmap",
	"$envmapmask",
	"$fallbackmaterial",
	"$hdrbaseTexture",
	"$hdrcompressedTexture",
	"$lightwarptexture",
	"$normalmap",
	"$phongexponenttexture",
	"$refracttinttexture",
	"$sheenmap",
	"$sheenmapmask",
	"$sheenmapmask",
	"$texture2",
	"$underwateroverlay",
])

const set = new Set(files.values().map((file) => file.toLowerCase()))

const surfaceprops = new Set(["$surfaceprop", "$surfaceprop2"])

interface Dependencies {
}

interface Globals {
	surfaceProperties: GlobalDefinitionReferences
}

export class VMTTextDocument extends TextDocumentBase<Dependencies, Globals, VDFDocumentSymbols> {

	public readonly languageId: "vmt" = "vmt"

	private readonly workspace: VDFWorkspace
	private readonly base: BaseDocument
	public readonly base$: Observable<string[]>

	protected getDiagnostics: (params: TextDocumentDiagnosticsParams<Dependencies, Globals, VDFDocumentSymbols>) => void
	public readonly decorations$: Observable<Decoration[]>
	public readonly baseTexture$: Observable<string | null>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TextDocument>,
		trpc: TRPCClient<ClientRouter>,
		workspace: VDFWorkspace,
		path: string | null,
	) {
		super(init, documentConfiguration$, fileSystem, documents, trpc, {
			path: path,
			getDocumentSymbols: (text) => getVDFDocumentSymbols(text, { multilineStrings: false }),
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			data$: defer(() => {
				return of<TextDocumentData<Dependencies, Globals, VDFDocumentSymbols>>({
					dependencies: {},
					globals: {
						surfaceProperties: { definitions$: workspace.surfaceProperties$ } satisfies GlobalDefinitionReferences
					},
					content$: defer(() => this.documentSymbols$).pipe(
						this.base.combineLatestBaseDefinitions((rest) => {
							const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
							const definitions = new Collection<Definition>()
							const references = new Collection<VDFText>()

							rest[0]?.children?.forAll((documentSymbol) => {
								if (surfaceprops.has(documentSymbol.key.text.toLowerCase()) && documentSymbol.value != undefined) {
									references.set(null, types.surfaceprop, documentSymbol.value.text, documentSymbol.value)
								}
							})

							return {
								scopes: scopes,
								definitions: definitions,
								references: references,
							}
						})
					),
				})
			}),
		})

		this.workspace = workspace
		this.base = new BaseDocument(this)
		this.base$ = this.base.base$

		interface VMTTextDocumentDiagnosticsContext extends DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols> {
			texture: Map<string, PartialDiagnosticCodeActionReference[]>
		}

		const d = DiagnosticFactory<VMTTextDocumentDiagnosticsContext, Dependencies, Globals>(this, KeyDistinct.First, (key) => key.toLowerCase())
		const texture = d.file("texture", "materials", ".vtf")

		const next = d.next({
			...Object.fromEntries(values.map((key) => <const>[key, d.set(["0", "1"])])),
			...Object.fromEntries(files.values().map((value) => <const>[value, texture.validate])),
		})

		const getDiagnostics = d.header(
			(name, value, path, diagnostics, context) => {
				value.children!.forAll((documentSymbol, path) => {
					next(documentSymbol.key.text, documentSymbol, path, diagnostics, context)
				}, [value])
			}
		)

		this.getDiagnostics = ({ diagnostics, ...params }) => {
			const context: VMTTextDocumentDiagnosticsContext = {
				...params,
				texture: new Map()
			}

			this.base.getDiagnostics(diagnostics, context)
			getDiagnostics(diagnostics, context)

			texture.connect(diagnostics, context)
		}

		this.decorations$ = of([])

		this.baseTexture$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				const header = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() != "#base")?.children
				if (!header) {
					return null
				}

				const baseTexture = header.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "$baseTexture".toLowerCase())?.value?.text
				if (!baseTexture) {
					return null
				}

				return resolvePath(`materials/${baseTexture}`, ".vtf")
			})
		)

		this.connect()
	}

	public async onDocumentFormatting(params: DocumentFormattingParams): Promise<string> {
		const documentFormattingConfiguration = (await firstValueFrom(this.documentConfiguration$)).vmt.format

		const options: VDFFormatStringifyOptions = {
			indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
			insertNewlineBeforeObjects: documentFormattingConfiguration.insertNewlineBeforeObjects,
			quotes: documentFormattingConfiguration.quotes,
			tabSize: params.options.tabSize,
			tabs: documentFormattingConfiguration.tabs,
			newLine: VDFNewLine.LF,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		return formatVDF(this.getText(), { multilineStrings: false }, options)
	}

	public async getDocumentLinks(): Promise<DocumentLinkResolve[]> {
		const documentSymbols = await firstValueFrom(this.documentSymbols$)

		return [
			...this.base.getDocumentLinks(documentSymbols),
			...documentSymbols.reduceRecursive<DocumentLinkResolve[]>([], (documentLinks, documentSymbol) => {
				if (set.has(documentSymbol.key.text.toLowerCase()) && documentSymbol.value?.text.trim().length) {
					documentLinks.push({
						range: documentSymbol.value.range,
						data: {
							resolve: async () => (await firstValueFrom(this.fileSystem.resolve(resolvePath(`materials/${documentSymbol.value!.text}`, ".vtf")))).uri
						}
					})
				}

				return documentLinks
			}),
		]
	}

	public async getDocumentColor(): Promise<ColourInformationStringify[]> {
		const documentSymbols = await firstValueFrom(this.documentSymbols$)
		return documentSymbols.reduceRecursive(<ColourInformationStringify[]>[], (documentColours, documentSymbol) => {
			if (documentSymbol.value == undefined) {
				return documentColours
			}

			if (/\[\s?[\d.]+\s+[\d.]+\s+[\d.]+\s?\]/.test(documentSymbol.value.text)) {
				const colour = documentSymbol.value.text.split(/[\s[\]]+/)

				const red = parseFloat(colour[1])
				const green = parseFloat(colour[2])
				const blue = parseFloat(colour[3])
				const alpha = 1

				documentColours.push({
					range: documentSymbol.value.range,
					color: { red, green, blue, alpha },
					stringify: (colour) => `[ ${colour.red.toFixed(2)} ${colour.green.toFixed(2)} ${colour.blue.toFixed(2)} ]`
				})
			}
			else if (/{\s?\d+\s+\d+\s+\d+\s?}/.test(documentSymbol.value.text)) {
				const colour = documentSymbol.value.text.split(/[\s{}]+/)

				const red = parseInt(colour[1]) / 255
				const green = parseInt(colour[2]) / 255
				const blue = parseInt(colour[3]) / 255
				const alpha = 1

				documentColours.push({
					range: documentSymbol.value.range,
					color: { red, green, blue, alpha },
					stringify: (colour) => `{ ${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} }`
				})
			}

			return documentColours
		})
	}

	public async onInlayHint(params: { range: VDFRange }): Promise<InlayHint[]> {
		return []
	}

	protected async getCompletion(params: VDFCompletionParams): Promise<VDFCompletionList | null> {
		return await VDFTextDocument.getCompletion(
			this,
			params,
			async (params, path, token) => {
				if (!path.length) {
					return {
						before: this.base.completionBaseKeys(params, token),
						cls: {
							one: ["LightmappedGeneric", "UnlitGeneric", "VertexlitGeneric"]
						}
					}
				}

				return {
					field: {
						one: keys.unlitgeneric
					}
				}
			},
			async (params, path, key, token) => {
				key = key.toLowerCase()
				if (key == "#base") {
					return this.base.completionBaseValues(params)
				}

				// Static
				if (keys.unlitgeneric.includes(key)) {
					return params.bits()
				}

				// Files
				if (files.values().some((file) => file.toLowerCase() == key)) {
					return await params.files({
						folder: "materials",
						params: params,
						token: token,
						basenamePattern: "*.vtf",
						map: "name"
					})
				}

				// Surface Properties
				if (surfaceprops.values().some((surfaceprop) => surfaceprop.toLowerCase() == key)) {
					const definitions = (await firstValueFrom(this.data$.pipe(switchMap((data) => data.globals.get("surfaceProperties").definitions$)))).ofType(null, types.surfaceprop)

					return {
						token: token,
						length: definitions.size,
						items: definitions.values().map((definition) => definition[0].completionItem),
					}
				}

				return null
			}
		)
	}
}
