import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { defer, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import { InlayHint, TextEdit } from "vscode-languageserver"
import type { TextDocumentInit } from "../../TextDocumentBase"
import { VDFTextDocument, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import { VGUIFileType, VGUIWorkspace } from "./VGUIWorkspace"
import { ClientSchemeSchema } from "./schemas/ClientSchemeSchema"
import { HUDAnimationsManifestSchema } from "./schemas/HUDAnimationsManifestSchema"
import { LanguageTokensSchema } from "./schemas/LanguageTokensSchema"
import { SourceSchemeSchema } from "./schemas/SourceSchemeSchema"
import { SurfacePropertiesManifestSchema } from "./schemas/SurfacePropertiesManifestSchema"
import { VGUISchema } from "./schemas/VGUISchema"

export class VGUITextDocument extends VDFTextDocument<VGUITextDocument> {

	public static keyTransform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "")
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
			keyTransform: VGUITextDocument.keyTransform,
			writeRoot: workspace?.uri ?? null,
			dependencies$: defer(() => {
				return (
					workspace != null
						? workspace.fileType(init.uri)
						: VGUIWorkspace.fileType(init.uri, teamFortress2Folder$)
				).pipe(
					map((type) => {
						if (type != VGUIFileType.None || workspace == null) {
							let schema: (document: VGUITextDocument) => VDFTextDocumentSchema<VGUITextDocument>
							switch (type) {
								case VGUIFileType.None:
									schema = VGUISchema
									break
								case VGUIFileType.ClientScheme:
									schema = ClientSchemeSchema
									break
								case VGUIFileType.SourceScheme:
									schema = SourceSchemeSchema
									break
								case VGUIFileType.LanguageTokens:
									schema = LanguageTokensSchema
									break
								case VGUIFileType.HUDAnimationsManifest:
									schema = HUDAnimationsManifestSchema
									break
								case VGUIFileType.SurfacePropertiesManifest:
									schema = SurfacePropertiesManifestSchema
									break
								default:
									throw new Error("unreachable")
							}

							return {
								schema: schema(this),
								globals$: of([])
							} satisfies VDFTextDocumentDependencies<VGUITextDocument>
						}
						else {
							return {
								schema: VGUISchema(this),
								globals$: workspace.globals$,
							} satisfies VDFTextDocumentDependencies<VGUITextDocument>
						}
					})
				)
			}),
		})

		this.workspace = workspace

		this.inlayHints$ = this.configuration.dependencies$.pipe(
			switchMap((dependencies) => {
				// if (dependencies.schema != VGUISchema) {
				// 	return of([])
				// }

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

								const documentSymbolKey = VGUITextDocument.keyTransform(documentSymbol.key.toLowerCase())
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
}
