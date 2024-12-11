import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, concatMap, distinctUntilChanged, map, of, switchMap, type Observable } from "rxjs"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, CompletionItemKind, DiagnosticSeverity } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import { VDFTextDocument, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import clientscheme from "./clientscheme.json"
import keys from "./keys.json"
import values from "./values.json"
import { VGUIFileType, VGUIWorkspace } from "./VGUIWorkspace"

export interface VGUITextDocumentDependencies {
}

export class VGUITextDocument extends VDFTextDocument<VGUITextDocument, VGUITextDocumentDependencies> {

	public static KeyTransform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "")

	public static readonly Schema: VDFTextDocumentSchema = {
		keys: keys,
		values: values,
		definitionReferences: [
			{
				type: Symbol.for("element"),
				definition: {
					directParentKeys: [],
					children: true,
					key: { name: "fieldName".toLowerCase(), priority: false }
				},
				reference: {
					keys: new Set([
						"pin_to_sibling",
						"navUp".toLowerCase(),
						"navDown".toLowerCase(),
						"navLeft".toLowerCase(),
						"navRight".toLowerCase(),
						"navToRelay".toLowerCase(),
					]),
					match: null
				}
			},
			{
				type: Symbol.for("color"),
				definition: null,
				reference: {
					keys: new Set(clientscheme.Colors),
					match: (string) => !/\d+\s+\d+\s+\d+\s+\d+/.test(string) // Exclude colour literals
				}
			},
			{
				type: Symbol.for("border"),
				definition: null,
				reference: {
					keys: new Set(clientscheme.Borders),
					match: null
				}
			},
			{
				type: Symbol.for("font"),
				definition: null,
				reference: {
					keys: new Set(clientscheme.Fonts),
					match: null
				}
			},
			{
				type: Symbol.for("string"),
				definition: null,
				reference: {
					keys: new Set(["labelText".toLowerCase(), "title"]),
					match: (string) => /^#/.test(string),
					toDefinition: (string) => string.substring("#".length)
				},
				toReference: (value) => `#${value}`,
				toCompletionItem: (definition) => ({ kind: CompletionItemKind.Text, insertText: `#${definition.key}` })
			}
		],
		files: [
			{
				name: "image",
				parentKeys: [],
				keys: new Set([
					"image",
					...Array.from({ length: 3 }, (_, index) => `teambg_${index + 1}`)
				]),
				folder: "materials/vgui",
				resolve: (name) => name.endsWith(".vmt") ? name : `${name}.vmt`,
				extensionsPattern: ".vmt",
				displayExtensions: false,
			},
			{
				name: "sound",
				parentKeys: [],
				keys: new Set([
					"sound_depressed",
					"sound_released"
				]),
				folder: "sound",
				resolve: (name) => name,
				extensionsPattern: null,
				displayExtensions: true
			}
		],
		colours: {
			keys: null,
			colours: [
				{
					pattern: /^\s?\d+\s+\d+\s+\d+\s+\d+\s?$/,
					parse(value) {
						const colour = value.split(/\s+/)
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
		}
	}

	public readonly workspace: VGUIWorkspace | null

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<VGUITextDocument>,
		workspace: VGUIWorkspace | null
	) {
		super(init, documentConfiguration$, fileSystem$, documents, {
			relativeFolderPath: workspace ? posix.dirname(workspace.relative(init.uri)) : null,
			VDFTokeniserOptions: {
				allowMultilineStrings: (() => {
					const basename = init.uri.basename()
					return basename == "gamemenu.res" || /(tf|chat)_.*?\.txt/.test(basename)
				})()
			},
			keyTransform: VGUITextDocument.KeyTransform,
			dependencies$: ((): Observable<VDFTextDocumentDependencies> => {
				const type$ = workspace != null
					? workspace.fileType(init.uri)
					: combineLatest({
						files: of({
							clientSchemeFiles: new Set(["resource/clientscheme.res"]),
							sourceSchemeFiles: new Set(["resource/sourcescheme.res", "resource/SourceSchemeBase.res"]),
							languageTokensFiles: new Set(["resource/chat_english.txt", "resource/tf_english.txt"])
						}),
						path: (() => {
							switch (init.uri.scheme) {
								case "file":
									return documentConfiguration$.pipe(
										map((documentConfiguration) => documentConfiguration.teamFortress2Folder),
										map((teamFortress2Folder) => posix.relative(teamFortress2Folder.joinPath("tf").path, init.uri.path))
									)
								case "vpk":
									return of(init.uri.path.substring(1))
								default:
									// https://github.com/microsoft/vscode/blob/main/src/vs/base/common/network.ts
									console.warn(`Unknown Uri.scheme: ${init.uri}`)
									return of(null)
							}
						})()
					}).pipe(
						map(({ files: { clientSchemeFiles, sourceSchemeFiles, languageTokensFiles }, path }) => {
							if (path != null) {
								if (clientSchemeFiles.has(path)) {
									return VGUIFileType.ClientScheme
								}
								else if (sourceSchemeFiles.has(path)) {
									return VGUIFileType.SourceScheme
								}
								else if (languageTokensFiles.has(path)) {
									return VGUIFileType.LanguageTokens
								}
								else {
									return VGUIFileType.None
								}
							}
							else {
								return VGUIFileType.None
							}
						}),
						distinctUntilChanged()
					)

				return type$.pipe(
					switchMap((type) => {
						if (type != VGUIFileType.None || workspace == null) {
							return of({
								schema: [VGUITextDocument.Schema, VGUIWorkspace.ClientSchemeSchema, VGUIWorkspace.SourceSchemeSchema, VGUIWorkspace.LanguageTokensSchema][type],
								global: []
							} satisfies VDFTextDocumentDependencies)
						}
						else {
							return combineLatest({
								clientScheme: workspace.clientScheme$,
								languageTokens: workspace.languageTokens$
							}).pipe(
								map(({ clientScheme, languageTokens }) => {
									return {
										schema: VGUITextDocument.Schema,
										global: [
											clientScheme,
											languageTokens
										]
									}
								})
							)
						}
					})
				)
			})(),
			getCodeLens: (definitionReferences$) => {
				if (workspace == null) {
					return definitionReferences$
				}

				return workspace.fileType(init.uri).pipe(
					switchMap((type) => {
						switch (type) {
							case VGUIFileType.None:
								const path = workspace.relative(init.uri)
								return definitionReferences$.pipe(
									switchMap((definitionReferences) => {
										return workspace.getFileReferences(path).pipe(
											map((references) => {
												definitionReferences.setDocumentReferences(references, false)
												return definitionReferences
											})
										)
									})
								)
							case VGUIFileType.ClientScheme:
								return definitionReferences$.pipe(
									concatMap(async (definitionReferences) => {
										await workspace.workspaceReferencesReady
										definitionReferences.setDocumentReferences(workspace.clientSchemeReferences.values().toArray(), false)
										return definitionReferences
									})
								)
							case VGUIFileType.SourceScheme:
								return definitionReferences$
							case VGUIFileType.LanguageTokens:
								return definitionReferences$.pipe(
									concatMap(async (definitionReferences) => {
										await workspace.workspaceReferencesReady
										definitionReferences.setDocumentReferences(workspace.languageTokensReferences.values().toArray(), false)
										return definitionReferences
									})
								)
						}
					})
				)
			},
		})
		this.workspace = workspace
	}

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null> {
		if (!documentSymbol.detail || !documentSymbol.detailRange) {
			return null
		}

		const key = this.configuration.keyTransform(documentSymbol.key.toLowerCase())

		if (key == "fieldName".toLowerCase()) {
			const parent = path.at(-1)?.key
			if (parent && documentSymbol.detail != parent) {
				return {
					range: documentSymbol.detailRange,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-fieldname",
					source: "vdf",
					message: `fieldName '${documentSymbol.detail}' does not match element name. Expected '${parent}'.`,
					data: {
						kind: CodeActionKind.QuickFix,
						fix: (createDocumentWorkspaceEdit) => {
							return {
								title: `Change fieldName to '${parent}'`,
								edit: createDocumentWorkspaceEdit(documentSymbol.detailRange!, parent),
							}
						},
					}
				}
			}
		}

		return null
	}
}
