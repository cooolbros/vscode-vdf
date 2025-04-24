import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { getHUDAnimationsDocumentSymbols, HUDAnimationsDocumentSymbols, HUDAnimationStatementType } from "hudanimations-documentsymbols"
import { posix } from "path"
import { combineLatest, combineLatestWith, defer, firstValueFrom, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import { CodeActionKind, DiagnosticSeverity, DiagnosticTag, type DocumentLink } from "vscode-languageserver"
import { Collection, DefinitionReferences, Definitions, References, type Definition } from "../DefinitionReferences"
import type { DiagnosticCodeAction } from "../LanguageServer"
import { TextDocumentBase, type TextDocumentInit } from "../TextDocumentBase"
import { Fonts } from "../VDF/VGUI/clientscheme.json"
import eventFiles from "./eventFiles.json"
import type { HUDAnimationsWorkspace } from "./HUDAnimationsWorkspace"

export const EventType = Symbol.for("event")

export interface HUDAnimationsTextDocumentDependencies {
}

export class HUDAnimationsTextDocument extends TextDocumentBase<HUDAnimationsDocumentSymbols, HUDAnimationsTextDocumentDependencies> {

	public static readonly colourProperties = new Set([
		"SelectedBoxColor",
		"SelectedFgColor",
		"TextColor",
		"Ammo2Color",
		"BgColor",
		"FgColor",
		"ItemColor",
		"MenuColor",
	].map((i) => i.toLowerCase()))

	public static readonly fontProperties = new Set(Fonts.map((i) => i.toLowerCase()))

	public readonly workspace: HUDAnimationsWorkspace | null
	public readonly links$: Observable<(Omit<DocumentLink, "data"> & { data: { uri: Uri; resolve: () => Promise<Uri | null> } })[]>
	public readonly decorations$: Observable<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		workspace: HUDAnimationsWorkspace | null,
	) {
		super(init, documentConfiguration$, fileSystem, {
			getDocumentSymbols: (text: string) => getHUDAnimationsDocumentSymbols(text),
			defaultDocumentSymbols: new HUDAnimationsDocumentSymbols(),
			definitionReferences$: defer(() => {
				if (workspace != null) {
					return workspace.manifest$.pipe(
						switchMap((documents) => {
							if (documents.includes(this)) {
								return workspace.definitionReferences$.pipe(
									map(({ documentSymbols, definitionReferences }) => {
										return {
											dependencies: {},
											documentSymbols: documentSymbols.get(this)!,
											definitionReferences: definitionReferences,
										}
									})
								)
							}
							else {
								return this.documentSymbols$.pipe(
									combineLatestWith(workspace.clientScheme$),
									switchMap(([documentSymbols, clientScheme]) => {

										const eventNames = new Set<string>()

										const definitions = new Collection<Definition>()
										const references = new Collection<VDFRange>()

										for (const documentSymbol of documentSymbols) {
											const key = documentSymbol.eventName.toLowerCase()

											eventNames.add(key)
											definitions.set(null, EventType, documentSymbol.eventName, {
												uri: this.uri,
												key: documentSymbol.eventName,
												range: documentSymbol.range,
												keyRange: documentSymbol.eventNameRange,
												conditional: documentSymbol.conditional?.value
											})

											for (const statement of documentSymbol.children) {
												if ("event" in statement) {
													references.set(null, EventType, statement.event, statement.eventRange)
												}

												if ("element" in statement) {
													references.set(null, Symbol.for(key), statement.element, statement.elementRange)
												}

												if (statement.type == HUDAnimationStatementType.Animate) {
													if (HUDAnimationsTextDocument.colourProperties.has(statement.property.toLowerCase())) {
														references.set(null, Symbol.for("color"), statement.value, statement.valueRange)
													}
												}

												if ("font" in statement) {
													references.set(null, Symbol.for("font"), statement.font, statement.fontRange)
												}
											}
										}

										return (
											eventNames.size != 0
												? combineLatest(eventNames.values().map((eventName) => workspace.getEventDefinitions(eventName)).filter((observable) => observable != null).toArray())
												: of([])
										).pipe(
											map((elements) => {
												return {
													dependencies: {},
													documentSymbols: documentSymbols,
													definitionReferences: new DefinitionReferences(
														new Map(),
														new Definitions({
															collection: definitions,
															globals: [
																...elements.map(({ definitions }) => definitions),
																clientScheme
															]
														}),
														new References(this.uri, references, [], this.references, this.references$)
													)
												}
											})
										)
									})
								)
							}
						})
					)
				}
				else {
					return this.documentSymbols$.pipe(
						map((documentSymbols) => {
							const definitions = new Collection<Definition>()
							const references = new Collection<VDFRange>()

							for (const documentSymbol of documentSymbols) {
								definitions.set(null, EventType, documentSymbol.eventName.toLowerCase(), {
									uri: this.uri,
									key: documentSymbol.eventName,
									range: documentSymbol.range,
									keyRange: documentSymbol.eventNameRange,
									conditional: documentSymbol.conditional?.value
								})

								for (const statement of documentSymbol.children) {
									if ("event" in statement) {
										references.set(null, EventType, statement.event, statement.eventRange)
									}
								}
							}

							return {
								dependencies: {},
								documentSymbols: documentSymbols,
								definitionReferences: new DefinitionReferences(
									new Map(),
									new Definitions({ collection: definitions }),
									new References(this.uri, references, [], this.references, this.references$)
								)
							}
						})
					)
				}
			}),
			getDiagnostics: (dependencies, documentSymbols, definitionReferences) => {
				return documentSymbols.reduce(
					(diagnostics, documentSymbol) => {
						const key = documentSymbol.eventName.toLowerCase()

						const events = definitionReferences.definitions.get(null, EventType, key)
						const definition = events?.find((definition) => definition.conditional?.toLowerCase() == documentSymbol.conditional?.value.toLowerCase())

						if (!definition || !definition.uri.equals(this.uri) || definition.keyRange != documentSymbol.eventNameRange) {
							diagnostics.push({
								range: documentSymbol.range,
								severity: DiagnosticSeverity.Hint,
								code: "duplicate-event",
								source: "hudanimations",
								message: "Unreachable code detected.",
								tags: [
									DiagnosticTag.Unnecessary
								],
								relatedInformation: events?.map((event) => ({
									location: {
										uri: event.uri.toString(),
										range: event.keyRange
									},
									message: `${event.key} is declared here.`
								})),
								data: {
									kind: CodeActionKind.QuickFix,
									fix: ({ createDocumentWorkspaceEdit }) => {
										return {
											title: "Remove duplicate event",
											isPreferred: true,
											edit: createDocumentWorkspaceEdit(documentSymbol.range, "")
										}
									},
								}
							})
						}

						for (const statement of documentSymbol.children) {
							if ("event" in statement) {
								const event = definitionReferences.definitions.get(null, EventType, statement.event.toLowerCase())
								if (!event || !event.length) {
									diagnostics.push({
										range: statement.eventRange,
										severity: DiagnosticSeverity.Warning,
										code: "invalid-reference",
										source: "hudanimations",
										message: `Cannot find event '${statement.event}'.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {

												const newText = findBestMatch(
													statement.event,
													[...definitionReferences.definitions.ofType(null, EventType).values()].flatMap((definitions) => definitions.map((definition) => definition.key))
												)

												if (!newText) {
													return null
												}

												return {
													title: `Change event to '${newText}'`,
													edit: createDocumentWorkspaceEdit(statement.eventRange, newText)
												}
											},
										}
									})
								}
							}

							if ("element" in statement && workspace != null && documentSymbol.eventName.toLowerCase() in eventFiles) {
								const type = Symbol.for(documentSymbol.eventName.toLowerCase())
								const definitions = definitionReferences.definitions.get(null, type, statement.element)

								if (!definitions || !definitions.length) {
									const files = workspace.files.get(documentSymbol.eventName.toLowerCase())
									if (files) {
										diagnostics.push(
											files.pipe(
												map((files) => {
													return {
														range: statement.elementRange,
														severity: DiagnosticSeverity.Warning,
														code: "invalid-reference",
														source: "hudanimations",
														message: `Cannot find element '${statement.element}'.`,
														relatedInformation: files.uris.map((uri) => ({
															location: {
																uri: uri.toString(),
																range: new VDFRange(new VDFPosition(0, 0))
															},
															message: "Elements are declared here."
														})),
														data: {
															kind: CodeActionKind.QuickFix,
															fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {

																const newText = findBestMatch(
																	statement.element,
																	definitionReferences
																		.definitions
																		.ofType(null, type)
																		.values()
																		.filter((definitions) => definitions.length)
																		.map((definitions) => definitions[0].key)
																		.toArray()
																)

																if (!newText) {
																	return null
																}

																return {
																	title: `Change element to '${newText}'`,
																	edit: createDocumentWorkspaceEdit(statement.elementRange, newText)
																}
															},
														}
													}
												})
											)
										)

									}
								}
							}

							if ("font" in statement && workspace != null) {
								const definitions = definitionReferences.definitions.get(null, Symbol.for("font"), statement.font)
								if (!definitions || !definitions.length) {
									diagnostics.push({
										range: statement.fontRange,
										severity: DiagnosticSeverity.Warning,
										code: "invalid-reference",
										source: "hudanimations",
										message: `Cannot find font '${statement.font}'.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {
												const newText = findBestMatch(
													statement.font,
													definitionReferences
														.definitions
														.ofType(null, Symbol.for("font"))
														.values()
														.filter((definitions) => definitions.length)
														.map((definitions) => definitions[0].key)
														.toArray()
												)

												if (!newText) {
													return null
												}

												return {
													title: `Change font to '${newText}'`,
													edit: createDocumentWorkspaceEdit(statement.fontRange, newText)
												}
											}
										}
									})
								}
							}

							if (statement.type == HUDAnimationStatementType.Animate && workspace != null && HUDAnimationsTextDocument.colourProperties.has(statement.property.toLowerCase()) && !/^\s*\d+\s+\d+\s+\d+\s+\d+\s*$/.test(statement.value)) {
								const type = Symbol.for("color")
								const definitions = definitionReferences.definitions.get(null, type, statement.value)
								if (!definitions || !definitions.length) {
									diagnostics.push({
										range: statement.valueRange,
										severity: DiagnosticSeverity.Warning,
										code: "invalid-reference",
										source: "hudanimations",
										message: `Cannot find colour '${statement.value}'.`,
										data: {
											kind: CodeActionKind.QuickFix,
											fix: ({ createDocumentWorkspaceEdit, findBestMatch }) => {
												const newText = findBestMatch(
													statement.value,
													definitionReferences
														.definitions
														.ofType(null, type)
														.values()
														.filter((definitions) => definitions.length)
														.map((definitions) => definitions[0].key)
														.toArray()
												)

												if (!newText) {
													return null
												}

												return {
													title: `Change colour to '${newText}'`,
													edit: createDocumentWorkspaceEdit(statement.valueRange, newText)
												}
											}
										}
									})
								}
							}

							if ("sound" in statement) {
								const path = posix.resolve(`/sound`, statement.sound.replaceAll(/[/\\]+/g, "/")).substring(1)
								diagnostics.push(
									fileSystem.resolveFile(path).pipe(
										map((uri) => {
											return uri != null
												? null
												: {
													range: statement.soundRange,
													severity: DiagnosticSeverity.Warning,
													source: "hudanimations",
													message: `Cannot find sound file '${statement.sound}'.`,
												}
										})
									)
								)
							}
						}

						return diagnostics
					},
					<(DiagnosticCodeAction | null | Observable<DiagnosticCodeAction | null>)[]>[]
				)
			},
		})

		this.workspace = workspace

		this.links$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols.flatMap((documentSymbol) => {
					return documentSymbol.children.reduce(
						(links, statement) => {
							if (statement.type == HUDAnimationStatementType.PlaySound) {
								links.push({
									range: statement.soundRange,
									data: {
										uri: this.uri,
										resolve: async () => {
											const path = `sound/${statement.sound.replaceAll(/[/\\]+/g, "/")}`
											return await firstValueFrom(fileSystem.resolveFile(path))
										}
									}
								})
							}
							return links
						},
						<(Omit<DocumentLink, "data"> & { data: { uri: Uri, resolve: () => Promise<Uri | null> } })[]>[]
					)
				})
			}),
			shareReplay(1)
		)

		this.decorations$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols.reduce(
					(decorations, documentSymbol) => {

						const eventName = documentSymbol.eventName.toLowerCase()

						// @ts-ignore
						const eventFile = eventFiles[eventName]
						if (eventFile) {
							decorations.push({
								range: documentSymbol.conditional?.range ?? documentSymbol.eventNameRange,
								renderOptions: {
									after: {
										contentText: Array.isArray(eventFile) ? eventFile.join(", ") : eventFile
									}
								}
							})
						}

						return decorations
					},
					<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>[]
				)
			}),
			shareReplay(1)
		)
	}
}
