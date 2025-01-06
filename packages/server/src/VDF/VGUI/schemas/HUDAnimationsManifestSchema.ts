import { CompletionItemKind } from "vscode-languageserver"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"

export const HUDAnimationsManifestSchema: VDFTextDocumentSchema = {
	keys: {
		hudanimations_manifest: {
			distinct: true,
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
			folder: null,
			resolve: (name) => name,
			extensionsPattern: null,
			displayExtensions: true,
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
