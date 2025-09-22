import type { VDFRange } from "vdf"
import { CompletionItemKind } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { KeyDistinct, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const SurfacePropertiesManifestSchema: VDFTextDocumentSchema<VGUITextDocument> = {
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
	getDefinitionReferences(params) {
		const scopes = new Map<symbol, Map<number, VDFRange>>()
		const definitions = new Collection<Definition>()
		const references = new Collection<VDFRange>()

		return {
			scopes: scopes,
			definitions: definitions,
			references: references,
		}
	},
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
