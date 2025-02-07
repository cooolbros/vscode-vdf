import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { of, type Observable } from "rxjs"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItemKind, InlayHint, InsertTextFormat } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFTextDocument, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import values from "./values.json"

export class VMTTextDocument extends VDFTextDocument<VMTTextDocument> {

	public readonly workspace: WorkspaceBase | null

	public readonly inlayHints$: Observable<InlayHint[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<VMTTextDocument>,
		workspace: WorkspaceBase | null,
		refCountDispose: (dispose: () => void) => void,
	) {
		super(init, documentConfiguration$, fileSystem$, documents, refCountDispose, {
			relativeFolderPath: workspace ? posix.dirname(workspace.relative(init.uri)) : null,
			VDFParserOptions: { multilineStrings: false },
			keyTransform: (key) => key,
			dependencies$: of<VDFTextDocumentDependencies>({
				schema: <VDFTextDocumentSchema>{
					keys: keys,
					values: values,
					definitionReferences: [],
					files: [
						{
							name: "image",
							parentKeys: [],
							keys: new Set(["$baseTexture".toLowerCase(), "$detail"]),
							folder: "materials",
							extensionsPattern: ".vtf",
							resolveBaseName: (value, withExtension) => withExtension(".vtf"),
							toCompletionItem: (name, type, withoutExtension) => withoutExtension(),
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
								insertText: "WaveSchedule\n{\n\t$0\n}",
								insertTextFormat: InsertTextFormat.Snippet
							},
							{
								label: "UnlitGeneric",
								kind: CompletionItemKind.Class,
								preselect: true,
								insertText: "WaveSchedule\n{\n\t$0\n}",
								insertTextFormat: InsertTextFormat.Snippet
							},
							{
								label: "VertexlitGeneric",
								kind: CompletionItemKind.Class,
								preselect: true,
								insertText: "WaveSchedule\n{\n\t$0\n}",
								insertTextFormat: InsertTextFormat.Snippet
							}
						],
						typeKey: null,
						defaultType: null
					}
				},
				globals: []
			}),
		})

		this.workspace = workspace

		this.inlayHints$ = of([])
	}

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null> {
		return null
	}
}
