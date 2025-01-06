import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, concatMap, distinctUntilChanged, map, of, switchMap, type Observable } from "rxjs"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import { VDFTextDocument, type VDFTextDocumentDependencies } from "../VDFTextDocument"
import { VGUIFileType, VGUIWorkspace } from "./VGUIWorkspace"
import { ClientSchemeSchema } from "./schemas/ClientSchemeSchema"
import { HUDAnimationsManifestSchema } from "./schemas/HUDAnimationsManifestSchema"
import { LanguageTokensSchema } from "./schemas/LanguageTokensSchema"
import { SourceSchemeSchema } from "./schemas/SourceSchemeSchema"
import { VGUISchema } from "./schemas/VGUISchema"

export interface VGUITextDocumentDependencies {
}

export class VGUITextDocument extends VDFTextDocument<VGUITextDocument, VGUITextDocumentDependencies> {

	public static KeyTransform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "")
	public readonly workspace: VGUIWorkspace | null

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<VGUITextDocument>,
		workspace: VGUIWorkspace | null,
		refCountDispose: (dispose: () => void) => void,
	) {
		super(init, documentConfiguration$, fileSystem$, documents, refCountDispose, {
			relativeFolderPath: (() => {
				if (workspace) {
					return posix.dirname(workspace.relative(init.uri))
				}
				else if (init.uri.scheme == "vpk") {
					return init.uri.dirname().path.substring(1)
				}
				else {
					return null
				}
			})(),
			VDFParserOptions: {
				multilineStrings: (() => {
					const basename = init.uri.basename()
					if (basename == "gamemenu.res") {
						return new Set(["command"])
					}
					else if (/(tf|chat)_.*?\.txt/.test(basename)) {
						return true
					}
					else {
						return false
					}
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
							const schemas = {
								[VGUIFileType.None]: VGUISchema,
								[VGUIFileType.ClientScheme]: ClientSchemeSchema,
								[VGUIFileType.SourceScheme]: SourceSchemeSchema,
								[VGUIFileType.LanguageTokens]: LanguageTokensSchema,
								[VGUIFileType.HUDAnimationsManifest]: HUDAnimationsManifestSchema
							}

							return of({
								schema: schemas[type],
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
										schema: VGUISchema,
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
							case VGUIFileType.HUDAnimationsManifest:
								return definitionReferences$
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
