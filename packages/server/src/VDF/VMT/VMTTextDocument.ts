import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { firstValueFrom, map, of, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { CompletionItemKind, DiagnosticSeverity, InsertTextFormat } from "vscode-languageserver"
import { Collection, type Definition } from "../../DefinitionReferences"
import type { DiagnosticCodeActions, DocumentLinkData, TextDocumentInit } from "../../TextDocumentBase"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFTextDocument, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import values from "./values.json"
import type { VMTWorkspace } from "./VMTWorkspace"

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

export class VMTTextDocument extends VDFTextDocument<VMTTextDocument> {

	public static readonly Schema = (document: VMTTextDocument): VDFTextDocumentSchema<VMTTextDocument> => {

		const file = document.diagnostics.file("image", "materials", ".vtf")

		const next = document.diagnostics.next({
			...Object.fromEntries(Object.entries(values).map(([key, value]) => <const>[key, document.diagnostics.set(value.values)])),
			...Object.fromEntries(files.entries().map((value) => <const>[value, file])),
		})

		const getDiagnostics = document.diagnostics.header(
			(key, documentSymbol, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				if (documentSymbol.children == undefined) {
					diagnostics.push({
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: "vmt",
						message: "Invalid header type.",
					})
					return diagnostics
				}

				documentSymbol.children.forAll((documentSymbol) => {
					diagnostics.push(...next(documentSymbol.key, documentSymbol, path, context))
				})

				return diagnostics
			},
			false
		)

		return {
			keys: keys,
			values: values,
			getDefinitionReferences(params) {
				const scopes = new Map<symbol, Map<number, VDFRange>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFRange>()

				return {
					scopes: scopes,
					definitions: definitions,
					references: references,
				}
			},
			definitionReferences: new Map(),
			getDiagnostics: getDiagnostics,
			getLinks: ({ documentSymbols, resolve }) => {
				const links: DocumentLinkData[] = []

				documentSymbols.forEach((documentSymbol) => {
					documentSymbol.children?.forAll((documentSymbol) => {
						const key = documentSymbol.key.toLowerCase()

						if (set.has(key) && documentSymbol.detail?.trim() != "") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`materials/${documentSymbol.detail}`, ".vtf")))
								}
							})
						}
					})
				})

				return links
			},
			getColours: ({ next }) => {
				return next((colours, documentSymbol) => {
					if (documentSymbol.detail != undefined) {
						if (/\[\s?[\d.]+\s+[\d.]+\s+[\d.]+\s?\]/.test(documentSymbol.detail)) {
							const colour = documentSymbol.detail.split(/[\s[\]]+/)

							const red = parseFloat(colour[1])
							const green = parseFloat(colour[2])
							const blue = parseFloat(colour[3])
							const alpha = 1

							colours.push({
								range: documentSymbol.detailRange!,
								color: { red, green, blue, alpha },
								stringify: (colour) => `[ ${colour.red.toFixed(2)} ${colour.green.toFixed(2)} ${colour.blue.toFixed(2)} ]`
							})
						}
						else if (/{\s?\d+\s+\d+\s+\d+\s?}/.test(documentSymbol.detail)) {
							const colour = documentSymbol.detail.split(/[\s{}]+/)

							const red = parseInt(colour[1]) / 255
							const green = parseInt(colour[2]) / 255
							const blue = parseInt(colour[3]) / 255
							const alpha = 1

							colours.push({
								range: documentSymbol.detailRange!,
								color: { red, green, blue, alpha },
								stringify: (colour) => `{ ${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} }`
							})
						}
					}
				})
			},
			getInlayHints: async (params) => {
				return []
			},
			completion: {
				root: [
					{
						label: "LightmappedGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "LightmappedGeneric\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					},
					{
						label: "UnlitGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "UnlitGeneric\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					},
					{
						label: "VertexlitGeneric",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "VertexlitGeneric\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					}
				],
				typeKey: null,
				defaultType: null,
				files: [
					{
						keys: set,
						folder: "materials",
						extensionsPattern: ".vtf",
						toCompletionItem: (name, type, withoutExtension) => ({ insertText: withoutExtension() }),
					}
				],
			}
		}
	}

	public readonly workspace: WorkspaceBase | null

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, VMTTextDocument>,
		workspace: VMTWorkspace | null,
	) {
		super(init, documentConfiguration$, fileSystem, documents, {
			relativeFolderPath: workspace ? posix.dirname(workspace.relative(init.uri)) : null,
			VDFParserOptions: { multilineStrings: false },
			keyTransform: (key) => key,
			dependencies$: (workspace?.surfaceProperties$ ?? of(null)).pipe(
				map((surfaceProperties) => {
					const schema = VMTTextDocument.Schema(this)
					return {
						schema: {
							...schema,
							values: {
								...schema.values,
								...(surfaceProperties != null && {
									$surfaceprop: {
										kind: CompletionItemKind.Constant,
										values: surfaceProperties
									}
								})
							},

						} satisfies VDFTextDocumentSchema<VMTTextDocument>,
						globals$: of([])
					}
				})
			)
		})

		this.workspace = workspace
	}
}
