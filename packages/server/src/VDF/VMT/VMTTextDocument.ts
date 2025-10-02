import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { map, of, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { CompletionItemKind, DiagnosticSeverity, InlayHint, InsertTextFormat } from "vscode-languageserver"
import { Collection, type Definition } from "../../DefinitionReferences"
import type { DiagnosticCodeActions, TextDocumentInit } from "../../TextDocumentBase"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFTextDocument, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import values from "./values.json"
import type { VMTWorkspace } from "./VMTWorkspace"

const files = [
	"%tooltexture",
	"$baseTexture".toLowerCase(),
	"$baseTexture2".toLowerCase(),
	"$blendmodulatetexture",
	"$bottommaterial",
	"$bumpmap",
	"$bumpmap2",
	"$detail",
	"$dudvmap",
	"$envmapmask",
	"$fallbackmaterial",
	"$hdrbaseTexture".toLowerCase(),
	"$hdrcompressedTexture".toLowerCase(),
	"$lightwarptexture",
	"$normalmap",
	"$phongexponenttexture",
	"$refracttinttexture",
	"$sheenmap",
	"$sheenmapmask",
	"$sheenmapmask",
	"$texture2",
	"$underwateroverlay",
]

export class VMTTextDocument extends VDFTextDocument<VMTTextDocument> {

	public static readonly Schema = (document: VMTTextDocument): VDFTextDocumentSchema<VMTTextDocument> => {

		const file = document.diagnostics.file("image", "materials", ".vtf")

		const next = document.diagnostics.next(new Map([
			...Object.entries(values).map(([key, value]) => <const>[key, document.diagnostics.set(value.values)]),
			...files.map((value) => <const>[value, file])
		]))

		const getDiagnostics = document.diagnostics.header(
			document,
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
			definitionReferences: [],
			getDiagnostics: getDiagnostics,
			files: [
				{
					name: "image",
					parentKeys: [],
					keys: new Set(files),
					folder: "materials",
					extension: ".vtf",
					extensionsPattern: ".vtf",
					resolveBaseName: (value, withExtension) => withExtension(".vtf"),
					toCompletionItem: (name, type, withoutExtension) => ({ insertText: withoutExtension() }),
				}
			],
			colours: {
				keys: null,
				colours: [
					{
						pattern: /\[\s?[\d.]+\s+[\d.]+\s+[\d.]+\s?\]/,
						parse(value) {
							const colour = value.split(/[\s[\]]+/)
							return {
								red: parseFloat(colour[1]),
								green: parseFloat(colour[2]),
								blue: parseFloat(colour[3]),
								alpha: 1
							}
						},
						stringify(colour) {
							return `[ ${colour.red.toFixed(2)} ${colour.green.toFixed(2)} ${colour.blue.toFixed(2)} ]`
						},
					},
					{
						pattern: /{\s?\d+\s+\d+\s+\d+\s?}/,
						parse(value) {
							const colour = value.split(/[\s{}]+/)
							return {
								red: parseInt(colour[1]) / 255,
								green: parseInt(colour[2]) / 255,
								blue: parseInt(colour[3]) / 255,
								alpha: 1
							}
						},
						stringify(colour) {
							return `{ ${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} }`
						},
					}
				]
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
				defaultType: null
			}
		}
	}

	public readonly workspace: WorkspaceBase | null

	public readonly inlayHints$: Observable<InlayHint[]>

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
			writeRoot: workspace?.uri ?? null,
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

		this.inlayHints$ = of([])
	}
}
