import { Uri } from "common/Uri"
import type { VDFRange } from "vdf"
import { DiagnosticSeverity } from "vscode-languageserver"
import type { Definition } from "../../../DefinitionReferences"
import { TextDocumentBase, type DiagnosticCodeActions } from "../../../TextDocumentBase"
import { KeyDistinct } from "../../VDFTextDocument"
import { PopfileBaseSchema } from "./PopfileBaseSchema"

export const MissionPopfileSchema = PopfileBaseSchema({
	definitionsSchema: {
		getTemplates: function*(documentSymbols) {
			const templatesBlock = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())
			const seen = new Set<string>()
			for (const template of templatesBlock?.children ?? []) {
				const key = template.key.toLowerCase()
				if (seen.has(key)) {
					continue
				}
				seen.add(key)

				yield template
			}
		},
	},
	diagnosticsSchema: {
		TemplatesDistinct: KeyDistinct.First,
		createValidateEvent: ({ document, createUnknownAttributeCodeAction }) => {
			return (documentSymbol, path, context, unknown) => {
				const diagnostics: DiagnosticCodeActions = []

				const name = context.dependencies.events.get(documentSymbol.key.toLowerCase())
				if (name == undefined) {
					if (context.dependencies.bsp != null) {
						diagnostics.push({
							range: documentSymbol.nameRange,
							severity: DiagnosticSeverity.Warning,
							code: "unknown-event",
							source: "popfile",
							message: `Unknown event '${documentSymbol.key}'. Expected '${[...context.dependencies.events.values()].join("' | '")}'`,
							data: createUnknownAttributeCodeAction(documentSymbol, context)
						})
					}
				}
				else {
					diagnostics.push(TextDocumentBase.diagnostics.key(name, documentSymbol.key, documentSymbol.nameRange))
				}

				return diagnostics
			}
		},
		createValidateTemplateReference: ({ document, createUnknownAttributeCodeAction }) => {
			return (name, detail, detailRange, documentSymbol, path, context, definitions) => {
				const diagnostics: DiagnosticCodeActions = []

				function validateTemplateReferenceInner(definition: Definition, seen: Set<string>) {
					const diagnostics: DiagnosticCodeActions = []

					// Dont push diagnostics for Templates declared in current document because they are already checked
					if (Uri.equals(definition.uri, document.uri)) {
						return diagnostics
					}

					const template: string | undefined = definition.data.template
					const events: { key: string, range: VDFRange }[] = definition.data.events

					if (template != undefined && !seen.has(template.toLowerCase())) {
						const definitions = context.definitionReferences.definitions.get(null, Symbol.for("template"), template) ?? []
						for (const definition of definitions) {
							diagnostics.push(...validateTemplateReferenceInner(definition, new Set([...seen, template.toLowerCase()])))
						}
					}

					for (const event of events) {
						const key = event.key.toLowerCase()
						const name = context.dependencies.events.get(key)
						if (name == undefined) {
							diagnostics.push({
								range: detailRange,
								severity: DiagnosticSeverity.Warning,
								code: "unknown-event",
								source: "popfile",
								message: `Unknown event '${event.key}' in template ${definition.key}.`,
								relatedInformation: [
									{
										location: {
											uri: definition.uri.toString(),
											range: event.range
										},
										message: `${event.key} is declared here.`
									}
								],
								data: createUnknownAttributeCodeAction(documentSymbol, context)
							})
						}
						else {
							diagnostics.push(TextDocumentBase.diagnostics.key(name, event.key, detailRange, { uri: () => definition.uri, range: () => event.range }))
						}
					}

					return diagnostics
				}

				for (const definition of definitions) {
					diagnostics.push(...validateTemplateReferenceInner(definition, new Set([definition.key.toLowerCase()])))
				}

				return diagnostics
			}
		}
	}
})
