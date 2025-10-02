import type { VDFRange } from "vdf"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"

export const SourceSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	return {
		keys: {},
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
		getDiagnostics: (params) => {
			return []
		},
		files: [],
		colours: {
			keys: null,
			colours: []
		},
		completion: {
			root: [],
			typeKey: null,
			defaultType: null
		}
	}
}
