import type { VDFRange } from "vdf"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"
import { ClientSchemeSchema } from "./ClientSchemeSchema"

export const SourceSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	const schema = ClientSchemeSchema(document)
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
		definitionReferences: new Map(),
		getDiagnostics: (params) => {
			return []
		},
		getLinks: schema.getLinks,
		getColours: schema.getColours,
		getInlayHints: schema.getInlayHints,
		completion: {
			root: [],
			typeKey: null,
			defaultType: null,
			files: [],
		}
	}
}
