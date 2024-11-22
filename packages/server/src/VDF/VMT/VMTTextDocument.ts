import { posix } from "path"
import { of, type Observable } from "rxjs"
import type { VSCodeVDFConfiguration } from "utils/types/VSCodeVDFConfiguration"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import type { WorkspaceBase } from "../../WorkspaceBase"
import { VDFTextDocument, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import values from "./values.json"

export interface VMTTextDocumentDependencies {
}

export class VMTTextDocument extends VDFTextDocument<VMTTextDocument, VMTTextDocumentDependencies> {

	public readonly workspace: WorkspaceBase | null

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<VMTTextDocument>,
		workspace: WorkspaceBase | null
	) {
		super(init, documentConfiguration$, fileSystem$, documents, {
			relativeFolderPath: workspace ? posix.dirname(workspace.relative(init.uri)) : null,
			VDFTokeniserOptions: { allowMultilineStrings: false },
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
							resolve: (name) => `${name}.vtf`,
							extensionsPattern: ".vtf",
							displayExtensions: false
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

				},
				global: []
			}),
			getCodeLens: (definitionReferences$) => {
				return definitionReferences$
			}
		})
		this.workspace = workspace
	}

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[]): DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | null> {
		return null
	}
}
