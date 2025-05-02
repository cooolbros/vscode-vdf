import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { combineLatest, defer, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, DiagnosticSeverity, InlayHint, TextEdit } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TextDocumentInit } from "../../TextDocumentBase"
import { VDFTextDocument, type VDFTextDocumentDependencies } from "../VDFTextDocument"
import { VGUIFileType, VGUIWorkspace } from "./VGUIWorkspace"
import { ClientSchemeSchema } from "./schemas/ClientSchemeSchema"
import { HUDAnimationsManifestSchema } from "./schemas/HUDAnimationsManifestSchema"
import { LanguageTokensSchema } from "./schemas/LanguageTokensSchema"
import { SourceSchemeSchema } from "./schemas/SourceSchemeSchema"
import { SurfacePropertiesManifestSchema } from "./schemas/SurfacePropertiesManifestSchema"
import { VGUISchema } from "./schemas/VGUISchema"

export class VGUITextDocument extends VDFTextDocument<VGUITextDocument> {

	public static KeyTransform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "")
	public readonly workspace: VGUIWorkspace | null

	public readonly inlayHints$: Observable<InlayHint[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		teamFortress2Folder$: Observable<Uri>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, VGUITextDocument>,
		workspace: VGUIWorkspace | null,
	) {
		super(init, documentConfiguration$, fileSystem, documents, {
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
			writeRoot: workspace?.uri ?? null,
			dependencies$: defer(() => {
				return (
					workspace != null
						? workspace.fileType(init.uri)
						: VGUIWorkspace.fileType(init.uri, teamFortress2Folder$)
				).pipe(
					switchMap((type) => {
						if (type != VGUIFileType.None || workspace == null) {
							const schemas = {
								[VGUIFileType.None]: VGUISchema,
								[VGUIFileType.ClientScheme]: ClientSchemeSchema,
								[VGUIFileType.SourceScheme]: SourceSchemeSchema,
								[VGUIFileType.LanguageTokens]: LanguageTokensSchema,
								[VGUIFileType.HUDAnimationsManifest]: HUDAnimationsManifestSchema,
								[VGUIFileType.SurfacePropertiesManifest]: SurfacePropertiesManifestSchema,
							}

							return of({
								schema: schemas[type],
								globals: []
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
										globals: [
											clientScheme,
											languageTokens
										]
									} satisfies VDFTextDocumentDependencies
								})
							)
						}
					})
				)
			}),
		})

		this.workspace = workspace

		this.inlayHints$ = this.configuration.dependencies$.pipe(
			switchMap((dependencies) => {
				if (dependencies.schema != VGUISchema) {
					return of([])
				}

				return this.definitionReferences$.pipe(
					switchMap((definitionReferences) => {
						return this.documentSymbols$.pipe(
							map((documentSymbols) => {
								return {
									documentSymbols,
									definitionReferences
								}
							})
						)
					}),
					map(({ documentSymbols, definitionReferences }) => {
						const string = Symbol.for("string")
						return documentSymbols.reduceRecursive(
							[] as InlayHint[],
							(inlayHints, documentSymbol) => {
								if (documentSymbol.children) {
									return inlayHints
								}

								const documentSymbolKey = VGUITextDocument.KeyTransform(documentSymbol.key.toLowerCase())
								if (documentSymbolKey in dependencies.schema.values) {
									const valueData = dependencies.schema.values[documentSymbolKey]
									if (valueData.enumIndex) {
										const index = parseInt(documentSymbol.detail!)
										if (!isNaN(index) && index >= 0 && index < valueData.values.length) {
											inlayHints.push({
												position: documentSymbol.detailRange!.end,
												label: valueData.values[index],
												textEdits: [TextEdit.replace(documentSymbol.detailRange!, valueData.values[index])],
												paddingLeft: true,
											})
										}
									}
								}

								const definitionReferencesConfiguration = dependencies
									.schema
									.definitionReferences
									.values()
									.filter((definitionReference): definitionReference is typeof definitionReference & { reference: NonNullable<typeof definitionReference["reference"]> } => definitionReference.reference != undefined)
									.find(({ reference: { keys } }) => keys.has(documentSymbolKey))

								if (definitionReferencesConfiguration != undefined && definitionReferencesConfiguration.type == string) {
									const detail = definitionReferencesConfiguration.reference.toDefinition
										? definitionReferencesConfiguration.reference.toDefinition(documentSymbol.detail!)
										: documentSymbol.detail!

									const definitions = definitionReferences.definitions.get(null, definitionReferencesConfiguration.type, detail)
									if (definitions?.[0].detail) {
										inlayHints.push({
											position: documentSymbol.detailRange!.end,
											label: definitions[0].detail,
											paddingLeft: true,
										})
									}
								}

								return inlayHints
							}
						)
					})
				)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)
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
						fix: ({ createDocumentWorkspaceEdit }) => {
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
