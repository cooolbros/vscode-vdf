import { CompletionItemKind } from "vscode-languageserver"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"

export const SurfacePropertiesManifestSchema: VDFTextDocumentSchema = {
	keys: {
		surfaceproperties_manifest: {
			distinct: KeyDistinct.First,
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
	definitionReferences: [],
	files: [
		{
			name: "file",
			parentKeys: [],
			keys: new Set([
				"file"
			]),
			folder: "",
			extensionsPattern: ".txt",
			resolveBaseName: (value, withExtension) => value,
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
