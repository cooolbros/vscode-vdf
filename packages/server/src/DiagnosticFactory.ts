import { EntryType, type Entry } from "common/FileSystemMountPoint"
import { resolvePath } from "common/resolvePath"
import { Uri } from "common/Uri"
import { posix } from "path"
import { finalize, ReplaySubject, share, type Observable, type Subscription } from "rxjs"
import { findBestMatch } from "string-similarity"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols, VDFText } from "vdf-documentsymbols"
import { DiagnosticSeverity, DiagnosticTag, TextEdit, type DocumentSymbol } from "vscode-languageserver"
import type { Definition } from "./DefinitionReferences"
import type { DefinitionType } from "./DefinitionTypes"
import { TextDocumentBase, type DiagnosticCodeAction, type GlobalsDefinitions, type GlobalsLike, type PartialDiagnosticCodeAction, type PartialDiagnosticCodeActionReference, type TextDocumentContent } from "./TextDocumentBase"
import type { TextDocument } from "./VDFLanguageServer"

export interface DiagnosticsContext<TDependencies, TGlobals extends GlobalsLike<TGlobals>, TDocumentSymbols extends DocumentSymbol[]> {
	readonly dependencies: TDependencies
	readonly globals: GlobalsDefinitions<TGlobals>
	readonly content: TextDocumentContent<TDocumentSymbols>
	readonly dispose$: Observable<void>
	subscriptions: Subscription[]
	next(): void
}

export type Validate<TInput, TContext> = (name: string, value: TInput, path: VDFDocumentSymbol[], diagnostics: PartialDiagnosticCodeAction[], context: TContext) => void

export const enum KeyDistinct {
	None,
	First,
	Last,
}

export type RefineString<TContext> = (name: string, detail: VDFText, documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], diagnostics: PartialDiagnosticCodeAction[], context: TContext) => void

export type RefineReference<TContext> = (...args: [...Parameters<RefineString<TContext>>, definitions: readonly Definition[]]) => void

export const unknown = Symbol()

const iterate = function*<T>(values: T[]) {
	for (let i = 0; i < values.length; i++) {
		yield values[i]
	}
}

const reverse = function*<T>(values: T[]) {
	for (let i = values.length - 1; i > 0; i--) {
		yield values[i]
	}
}

export function DiagnosticFactory<
	TContext extends DiagnosticsContext<TDependencies, TGlobals, VDFDocumentSymbols>,
	TDependencies,
	TGlobals extends GlobalsLike<TGlobals>,
>(
	document: TextDocument,
	distinct: KeyDistinct,
	transform: (key: string) => string,
	unknownDiagnostic: (...args: [...Parameters<Validate<VDFDocumentSymbol, TContext>>]) => void = (name, value, path, diagnostics, context) => diagnostics.push({
		range: value.key.range,
		severity: DiagnosticSeverity.Warning,
		code: "unknown-key",
		source: document.languageId,
		message: `Unknown key '${value.key.text}'.`
	})
) {
	const finds = { [KeyDistinct.First]: Array.prototype.find, [KeyDistinct.Last]: Array.prototype.findLast }
	const weakMapFirst = new WeakMap<VDFDocumentSymbols, Map<string, VDFDocumentSymbol[]>>()
	const weakMapLast = new WeakMap<VDFDocumentSymbols, Map<string, VDFDocumentSymbol[]>>()

	const unreachable = (range: VDFRange): DiagnosticCodeAction => {
		return {
			range: range,
			severity: DiagnosticSeverity.Hint,
			code: "unreachable",
			message: "Unreachable code detected.",
			tags: [
				DiagnosticTag.Unnecessary
			],
		}
	}

	const duplicateKey = (documentSymbol: VDFDocumentSymbol, first: VDFDocumentSymbol): DiagnosticCodeAction => {
		return {
			range: documentSymbol.key.range,
			severity: DiagnosticSeverity.Warning,
			code: "duplicate-key",
			source: document.languageId,
			message: `Duplicate key '${first.key.text}'`,
			relatedInformation: [
				{
					location: {
						uri: document.uri.toString(),
						range: first.key.range
					},
					message: `${first.key.text} is declared here.`
				}
			],
			data: {
				fix: ({ createDocumentWorkspaceEdit }) => {
					return {
						title: `Remove duplicate ${first.key.text}`,
						edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
					}
				}
			}
		}
	}

	const checkDistinct = (distinct: KeyDistinct, documentSymbol: VDFDocumentSymbol, parent: VDFDocumentSymbols, diagnostics: PartialDiagnosticCodeAction[]) => {
		if (distinct == KeyDistinct.None) {
			return
		}

		if (parent.length >= 32) {
			const [weakMap, generate] = distinct == KeyDistinct.First ? [weakMapFirst, iterate] : [weakMapLast, reverse]
			const map = weakMap.getOrInsertComputed(parent, () => Map.groupBy(generate(parent), (documentSymbol) => documentSymbol.key.text.toLowerCase()))
			const first = map.get(documentSymbol.key.text.toLowerCase())!.find((i) => i.conditional?.toUpperCase() == documentSymbol.conditional?.toUpperCase())!
			if (first != documentSymbol) {
				diagnostics.push(duplicateKey(documentSymbol, first))
			}
		}
		else {
			const first = finds[distinct].call(parent, (i: VDFDocumentSymbol) => i.key.text.toLowerCase() == documentSymbol.key.text.toLowerCase() && i.conditional?.toUpperCase() == documentSymbol.conditional?.toUpperCase())!
			if (first != documentSymbol) {
				diagnostics.push(duplicateKey(documentSymbol, first))
			}
		}
	}

	const checkCanonicalKey = (
		name: string,
		key: VDFText,
		diagnostics: PartialDiagnosticCodeAction[],
		edit?: { uri?: () => Uri, range?: () => VDFRange, newText?: (name: string) => string }
	) => {
		if (name != key.text) {
			diagnostics.push({
				range: key.range,
				severity: DiagnosticSeverity.Information,
				code: "key",
				message: name,
				data: {
					fix: ({ params }) => {
						const uri = edit?.uri?.() ?? params.textDocument.uri
						return {
							title: `Replace '${key.text}' with '${name}'`,
							edit: {
								changes: {
									[uri.toString()]: [TextEdit.replace(edit?.range?.() ?? key.range, edit?.newText?.(name) ?? name)]
								}
							}
						}
					}
				}
			})
		}
	}

	return {
		any: () => () => { },
		unreachable: unreachable,
		distinct: checkDistinct,
		canonical: checkCanonicalKey,
		unknown: unknownDiagnostic,
		sequence: (...args: Validate<VDFDocumentSymbol, TContext>[]): Validate<VDFDocumentSymbol, TContext> => {
			return (name, value, path, diagnostics, context) => {
				for (const validate of args) {
					validate(name, value, path, diagnostics, context)
				}
			}
		},
		header: (validate: Validate<VDFDocumentSymbol, TContext>) => {
			return (diagnostics: PartialDiagnosticCodeAction[], context: TContext) => {

				const { base = [], rest: headers = [] } = Object.groupBy(
					context.content.documentSymbols,
					(documentSymbol) => documentSymbol.key.text.toLowerCase() == "#base" ? "base" : "rest"
				)

				const [header, ...rest] = headers
				if (header == undefined) {
					return
				}

				if (header.children == undefined) {
					diagnostics.push({
						range: header.value!.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: document.languageId,
						message: "Invalid header type.",
					})
				}
				else {
					validate(header.key.text, header, [], diagnostics, context)
				}

				diagnostics.push(...rest.map((documentSymbol) => unreachable(documentSymbol.range)))
			}
		},
		record: (validate: Validate<VDFDocumentSymbol, TContext>, d = distinct): Validate<VDFDocumentSymbol, TContext> => {
			return (key, value, path, diagnostics, context) => {
				const parent = value
				if (parent.children == undefined) {
					diagnostics.push({
						range: parent.value!.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: document.languageId,
						message: `Invalid ${key} type.`,
					})
				}
				else {
					const childrenPath = [...path, parent]
					for (const documentSymbol of parent.children) {
						validate(documentSymbol.key.text, documentSymbol, childrenPath, diagnostics, context)
						checkDistinct(d, documentSymbol, parent.children, diagnostics)
					}
				}
			}
		},
		documentSymbols: (schema: Record<string, Validate<VDFDocumentSymbol, TContext> | [Validate<VDFDocumentSymbol, TContext>, KeyDistinct]> & Record<symbol, Validate<VDFDocumentSymbol, TContext>>): Validate<VDFDocumentSymbol, TContext> => {
			const validateUnknown = unknown in schema ? schema[unknown] : unknownDiagnostic
			const map = new Map(Object.entries(schema).map(([key, entry]) => [key.toLowerCase(), Array.isArray(entry) ? ({ key, validate: entry[0], distinct: entry[1] }) : ({ key, validate: entry, distinct: distinct })]))

			return (name, value, path, diagnostics, context) => {
				const parent = value
				if (parent.children == undefined) {
					diagnostics.push({
						range: parent.value!.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: document.languageId,
						message: `Invalid ${name} type.`,
					})
				}
				else {
					const childrenPath = [...path, parent]
					parent.children.forEach((documentSymbol) => {
						const data = map.get(transform(documentSymbol.key.text))
						if (data == undefined) {
							validateUnknown(name, documentSymbol, childrenPath, diagnostics, context)
						}
						else {
							data.validate(data.key, documentSymbol, childrenPath, diagnostics, context)
							checkDistinct(data.distinct, documentSymbol, parent.children!, diagnostics)
							checkCanonicalKey(data.key, documentSymbol.key, diagnostics)
						}
					})
				}
			}
		},
		string: (refine?: RefineString<TContext>): Validate<VDFDocumentSymbol, TContext> => {
			return (name, value, path, diagnostics, context) => {
				if (value.value == undefined) {
					diagnostics.push({
						range: value.childrenRange!,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-type",
						source: document.languageId,
						message: `Invalid ${name} type.`,
					})
				}
				else {
					refine?.(name, value.value, value, path, diagnostics, context)
				}
			}
		},
		integer: (): RefineString<TContext> => {
			return (name, detail, documentSymbol, path, diagnostics, context) => {
				if (/\D/.test(detail.text)) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-integer",
						source: document.languageId,
						message: `Invalid value for ${name}. Expected integer`,
					})
				}
			}
		},
		float: (): RefineString<TContext> => {
			return (name, detail, documentSymbol, path, diagnostics, context) => {
				if (!/^\d*\.?\d+$/.test(detail.text)) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-float",
						source: document.languageId,
						message: `Invalid value for ${name}. Expected float`,
					})
				}
			}
		},
		set: (values: string[], fix?: Record<string, string>): RefineString<TContext> => {
			const map = new Map(values.map((value) => [value.toLowerCase(), value]))
			return (name, detail, documentSymbol, path, diagnostics, context) => {
				const text = detail.text.toLowerCase()
				if (!map.has(text)) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-value",
						source: document.languageId,
						message: `'${detail.text}' is not a valid value for ${name}. Expected '${values.join("' | '")}'.`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								const match = findBestMatch(detail.text, values).bestMatch
								if (match.rating < 0.5) {
									return null
								}

								return {
									title: `Change ${name} to '${match.target}'`,
									edit: createDocumentWorkspaceEdit(TextDocumentBase.replaceTokenTextEdit(detail, match.target))
								}
							}
						}
					})
				}
				else {
					checkCanonicalKey(map.get(text)!, detail, diagnostics)
				}
			}
		},
		reference: (type: DefinitionType, global: keyof TGlobals | null, refine?: RefineReference<TContext>): RefineString<TContext> => {
			const getDefinitions = global != null
				? (context: TContext) => context.globals[global]
				: (context: TContext) => context.content.definitionReferences.definitions

			return (name, detail, documentSymbol, path, diagnostics, context) => {
				if (!detail.text.length || !type.test(detail.text)) {
					return
				}

				const scope = context.content.definitionReferences.scopes.get(type)?.entries().find(([scope, ranges]) => ranges.some((range) => range.contains(detail.range)))?.[0] ?? null
				const definitions = getDefinitions(context).get(scope, type, type.toDefinition(detail.text))

				if (!definitions || !definitions.length) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-reference",
						source: document.languageId,
						message: `Cannot find ${type.name} '${detail.text}'.`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								const definition = [...getDefinitions(context).ofType(null, type).values()].map((definition) => definition[0].key)
								if (!definition.length) {
									return null
								}

								const match = findBestMatch(detail.text, definition).bestMatch
								if (match.rating < 0.5) {
									return null
								}

								return {
									title: `Change ${type.name} to '${match.target}'`,
									edit: createDocumentWorkspaceEdit(TextDocumentBase.replaceTokenTextEdit(detail, match.target))
								}
							}
						}
					})
				}
				else {
					if (definitions.some((definition) => Uri.equals(definition.uri, document.uri) && definition.range.contains(detail.range))) {
						diagnostics.push({
							range: detail.range,
							severity: DiagnosticSeverity.Warning,
							code: "self-reference",
							source: document.languageId,
							message: `${name} '${detail.text}' references itself.`,
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: `Remove ${documentSymbol.key.text}`,
										isPreferred: true,
										edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
									}
								},
							}
						})
					}

					refine?.(name, detail, documentSymbol, path, diagnostics, context, definitions)
					checkCanonicalKey(definitions[0].key, { text: type.toDefinition(detail.text), range: detail.range, tokenRange: detail.tokenRange, quoted: detail.quoted }, diagnostics, { newText: (name) => type.renameReference(detail.text, name) })
				}
			}
		},
		file: <P extends string>(id: P, folder: string | null, extension: `.${string}` | undefined) => {
			type Context = TContext & { [K in P]: Map<string, PartialDiagnosticCodeActionReference[]> }
			const map = new Map<string, Observable<Entry>>()

			const validate: RefineString<Context> = (name, detail, documentSymbol, path, diagnostics, context) => {
				if (!detail.text.length) {
					return
				}

				const value = detail.text.replaceAll(/[/\\]+/g, "/")

				const newPath = folder != null
					? posix.relative(`/${folder}`, posix.resolve(`/${folder}/${value}`))
					: posix.resolve(`/${value}`).substring(1)

				if (value != newPath) {
					diagnostics.push({
						range: detail.range,
						severity: DiagnosticSeverity.Warning,
						code: "useless-path",
						source: document.languageId,
						message: `Unnecessary relative file path. Expected '${newPath}'`,
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Normalize file path",
									edit: createDocumentWorkspaceEdit(TextDocumentBase.replaceTokenTextEdit(detail, newPath))
								}
							}
						}
					})
				}

				const filePath = resolvePath(`${folder != null ? `${folder}/` : ""}${value}`, extension)
				context[id].getOrInsertComputed(filePath, () => []).push({ index: diagnostics.length, range: detail.range, name: name, detail: detail.text })
				diagnostics.push(undefined)
			}

			const connect = (diagnostics: PartialDiagnosticCodeAction[], context: Context) => {
				for (const [path, values] of context[id]) {
					context.subscriptions.push(
						map.getOrInsertComputed(
							path,
							() => document.fileSystem.resolve(path).pipe(
								finalize(() => map.delete(path)),
								share({ connector: () => new ReplaySubject(1), resetOnRefCountZero: () => context.dispose$ })
							)
						).subscribe((entry) => {
							switch (entry.type) {
								case EntryType.None: {
									for (const { index, detail, name, range } of values) {
										diagnostics[index] = {
											range: range,
											severity: DiagnosticSeverity.Warning,
											code: "file-not-found",
											source: document.languageId,
											message: `Cannot find ${name} '${detail}'. (Resolved to "${path}")`,
										}
									}
									break
								}
								case EntryType.File: {
									for (const { index, detail, name, range } of values) {
										diagnostics[index] = null
									}
									break
								}
								case EntryType.Directory: {
									for (const { index, detail, name, range } of values) {
										diagnostics[index] = {
											range: range,
											severity: DiagnosticSeverity.Warning,
											code: "file-is-directory",
											source: document.languageId,
											message: `${name} references a directory. (Resolved to "${path}")`,
										}
									}
									break
								}
							}

							context.next()
						})
					)
				}
			}

			return {
				validate,
				connect,
			}
		},
		next: (schema: Record<string, RefineString<TContext>>): Validate<VDFDocumentSymbol, TContext> => {
			const map = new Map(Object.entries(schema).map(([name, refine]) => <const>[name.toLowerCase(), { name, refine }]))
			return (key, documentSymbol, path, diagnostics, context) => {
				const data = map.get(key)
				if (data != undefined && documentSymbol.value != undefined) {
					data.refine(data.name, documentSymbol.value, documentSymbol, path, diagnostics, context)
				}
			}
		}
	}
}
