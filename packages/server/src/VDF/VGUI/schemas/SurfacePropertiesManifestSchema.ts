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
		definitionReferences: new Map(),
		getDiagnostics: schema.getDiagnostics,
		getLinks: schema.getLinks,
		getColours: schema.getColours,
		getInlayHints: schema.getInlayHints,
		completion: {
			root: [
				{
					label: "surfaceproperties_manifest",
					kind: CompletionItemKind.Class
				}
			],
			typeKey: null,
			defaultType: null,
			files: [
				{
					keys: new Set([
						"file"
					]),
					folder: null,
					extensionsPattern: ".txt",
				},
			],
		}
	}
}
