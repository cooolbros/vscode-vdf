import { CompletionItemKind } from "vscode-languageserver"
import { type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"
import { HUDAnimationsManifestSchema } from "./HUDAnimationsManifestSchema"

export const SurfacePropertiesManifestSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	const schema = HUDAnimationsManifestSchema(document)
	return {
		keys: {
			surfaceproperties_manifest: {
				values: [
					{
						label: "file",
						kind: CompletionItemKind.Variable,
						multiple: true
					}
				]
			}
		},
		values: {},
		getDefinitionReferences: schema.getDefinitionReferences,
		definitionReferences: [],
		getDiagnostics: schema.getDiagnostics,
		getLinks: schema.getLinks,
		getColours: schema.getColours,
		getInlayHints: schema.getInlayHints,
		files: [
			{
				name: "file",
				keys: new Set([
					"file"
				]),
				folder: null,
				extension: null,
				extensionsPattern: ".txt",
			},
		],
		colours: {
			keys: null,
			colours: []
		},
		completion: {
			root: [
				{
					label: "surfaceproperties_manifest",
					kind: CompletionItemKind.Class
				}
			],
			typeKey: null,
			defaultType: null
		}
	}
}
