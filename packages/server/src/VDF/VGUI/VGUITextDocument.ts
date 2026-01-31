import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { posix } from "path"
import { defer, map, of, shareReplay, startWith, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import { Collection, Definitions, References, type DefinitionReferences } from "../../DefinitionReferences"
import type { TextDocumentInit } from "../../TextDocumentBase"
import { VDFTextDocument, type VDFTextDocumentDependencies, type VDFTextDocumentSchema } from "../VDFTextDocument"
import { VGUIFileType, VGUIWorkspace } from "./VGUIWorkspace"
import { ChatSchemeSchema } from "./schemas/ChatSchemeSchema"
import { ClientSchemeSchema } from "./schemas/ClientSchemeSchema"
import { HUDAnimationsManifestSchema } from "./schemas/HUDAnimationsManifestSchema"
import { LanguageTokensSchema } from "./schemas/LanguageTokensSchema"
import { SourceSchemeSchema } from "./schemas/SourceSchemeSchema"
import { SurfacePropertiesManifestSchema } from "./schemas/SurfacePropertiesManifestSchema"
import { VGUISchema } from "./schemas/VGUISchema"

export class VGUITextDocument extends VDFTextDocument<VGUITextDocument> {

	public static keyTransform = (key: string) => key.replace(/_(minmode|override|(lo|hi)def)$/, "")
	public readonly workspace: VGUIWorkspace | null

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
			dependencies$: defer(() => {
				return (
					workspace != null
						? workspace.fileType(init.uri)
						: VGUIWorkspace.fileType(init.uri, teamFortress2Folder$)
				).pipe(
					map((type) => {
						let schema: (document: VGUITextDocument) => VDFTextDocumentSchema<VGUITextDocument>
						let globals$: Observable<DefinitionReferences[]>

						switch (type) {
							case VGUIFileType.None:
								schema = VGUISchema
								globals$ = workspace?.globals$ ?? of([])
								break
							case VGUIFileType.ClientScheme:
								schema = ClientSchemeSchema
								if (workspace && workspace.relative(this.uri).toLowerCase() != "resource/clientscheme.res") {
									globals$ = workspace.clientScheme$.pipe(
										startWith({
											scopes: new Map(),
											definitions: new Definitions({ version: [] }),
											references: new References(this.uri, new Collection<VDFRange>(), [])
										} satisfies DefinitionReferences),
										map((definitionReferences) => [definitionReferences]),
										shareReplay(1)
									)
								}
								else {
									globals$ = of([])
								}
								break
							case VGUIFileType.SourceScheme:
								schema = SourceSchemeSchema
								globals$ = of([])
								break
							case VGUIFileType.ChatScheme:
								schema = ChatSchemeSchema
								globals$ = of([])
								break
							case VGUIFileType.LanguageTokens:
								schema = LanguageTokensSchema
								globals$ = of([])
								break
							case VGUIFileType.HUDAnimationsManifest:
								schema = HUDAnimationsManifestSchema
								globals$ = of([])
								break
							case VGUIFileType.SurfacePropertiesManifest:
								schema = SurfacePropertiesManifestSchema
								globals$ = of([])
								break
							default:
								throw new Error("unreachable")
						}

						return {
							schema: schema(this),
							globals$: globals$,
						} satisfies VDFTextDocumentDependencies<VGUITextDocument>
					})
				)
			}),
		})

		this.workspace = workspace
	}
}
