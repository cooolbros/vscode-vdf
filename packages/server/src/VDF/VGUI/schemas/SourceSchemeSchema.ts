import type { VDFTextDocumentSchema } from "../../VDFTextDocument"

export const SourceSchemeSchema: VDFTextDocumentSchema = {
	keys: {},
	values: {},
	definitionReferences: [],
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
