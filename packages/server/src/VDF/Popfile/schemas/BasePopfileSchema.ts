import { KeyDistinct } from "../../VDFTextDocument"
import { PopfileBaseSchema } from "./PopfileBaseSchema"

export const BasePopfileSchema = PopfileBaseSchema({
	definitionsSchema: {
		getTemplates: function*(documentSymbols) {
			const templatesBlocks = documentSymbols.values().filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())
			for (const templatesBlock of templatesBlocks) {
				const seen = new Set<string>()
				for (const template of templatesBlock?.children ?? []) {
					const key = template.key.toLowerCase()
					if (seen.has(key)) {
						continue
					}
					seen.add(key)

					yield template
				}
			}
		},
	},
	diagnosticsSchema: {
		TemplatesDistinct: KeyDistinct.None,
		createValidateEvent: ({ document, createUnknownAttributeCodeAction }) => {
			return (documentSymbol, path, context, unknown) => {
				return []
			}
		},
		createValidateTemplateReference: ({ document, createUnknownAttributeCodeAction }) => {
			return (name, detail, detailRange, documentSymbol, path, context, definitions) => {
				// Don't push diagnostics for Templates declared in files with no .bsp because the valid events are not yet known
				return []
			}
		}
	}
})
