import type { VDFRange } from "vdf"
import { Collection, type Definition } from "../../../DefinitionReferences"
import { type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"

export const SurfacePropertiesSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {
	return {
		keys: {},
		values: {},
		getDefinitionReferences: (params) => {
			const surfaceprop = Symbol.for("surfaceprop")

			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			for (const documentSymbol of params.getDocumentSymbols()) {
				definitions.set(null, surfaceprop, documentSymbol.key, {
					uri: document.uri,
					key: documentSymbol.key,
					range: documentSymbol.range,
					keyRange: documentSymbol.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(documentSymbol),
					conditional: documentSymbol.conditional ?? undefined,
				})
			}

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
		getLinks: async (params) => {
			return []
		},
		getColours: (params) => {
			return []
		},
		getInlayHints: async (params) => {
			return []
		},
		completion: {
			root: [],
			typeKey: null,
			defaultType: null,
			files: [],
		}
	}
}
