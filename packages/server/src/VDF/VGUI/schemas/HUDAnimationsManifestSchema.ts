import { CompletionItemKind } from "vscode-languageserver"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"

export const HUDAnimationsManifestSchema: VDFTextDocumentSchema = {
	keys: {
		hudanimations_manifest: {
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
			extensionsPattern: null,
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
				label: "hudanimations_manifest",
				kind: CompletionItemKind.Class
			}
		],
		typeKey: null,
		defaultType: null
	}
}
