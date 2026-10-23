import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { type CompletionToken } from "common/generateTokens"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { resolvePath } from "common/resolvePath"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { getHUDAnimationsDocumentSymbols, HUDAnimationsDocumentSymbols, HUDAnimationStatementType } from "hudanimations-documentsymbols"
import { formatHUDAnimations, type HUDAnimationsFormatStringifyOptions } from "hudanimations-format"
import { BehaviorSubject, combineLatest, defer, distinctUntilChanged, finalize, firstValueFrom, identity, map, Observable, of, ReplaySubject, share, switchMap } from "rxjs"
import { findBestMatch } from "string-similarity"
import { VDFPosition, VDFRange } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { quote } from "vdf-format"
import { CodeActionKind, CompletionItemKind, DiagnosticSeverity, DiagnosticTag, InsertTextFormat, MarkupKind, TextEdit, type CodeLens, type CodeLensParams, type Connection, type DocumentFormattingParams, type InlayHint, type WorkspaceEdit } from "vscode-languageserver"
import { Collection, Definitions, References, type Definition } from "../DefinitionReferences"
import { types, type DefinitionType } from "../DefinitionTypes"
import { TextDocumentBase, type ColourInformationStringify, type Decoration, type DocumentLinkResolve, type PartialDiagnosticCodeActionReference, type TextDocumentData, type TextDocumentDiagnosticsParams, type TextDocumentInit, type VDFCompletionItem, type VDFCompletionList, type VDFCompletionParams, type VDFRenameParams } from "../TextDocumentBase"
import clientscheme from "../VDF/clientscheme.json"
import type { TextDocument, VDFLanguageServer } from "../VDFLanguageServer"
import type { GlobalDefinitionReferences, VDFWorkspace } from "../VDFWorkspace"
import eventFiles from "./eventFiles.json"

interface Dependencies {
}

interface Globals {
	clientScheme: GlobalDefinitionReferences
}

export class HUDAnimationsTextDocument extends TextDocumentBase<Dependencies, Globals, HUDAnimationsDocumentSymbols> {

	private static readonly eventScopes = new Map<keyof typeof eventFiles, number>(Object.entries(eventFiles).map(([event, _path], index) => <const>[<keyof typeof eventFiles>event, index]))

	private static readonly keywords = <const>[
		"Animate",
		"RunEvent",
		"StopEvent",
		"SetVisible",
		"FireCommand",
		"RunEventChild",
		"SetInputEnabled",
		"PlaySound",
		"StopPanelAnimations",
		"SetFont",
		"SetTexture",
		"SetString",
	]

	private static readonly properties = <const>[
		"Alpha",
		"Ammo2Color",
		"BgColor",
		"Blur",
		"FgColor",
		"HintSize",
		"icon_expand",
		"ItemColor",
		"MenuColor",
		"Position",
		"PulseAmount",
		"SelectionAlpha",
		"Size",
		"tall",
		"TextScan",
		"wide",
		"xpos",
		"ypos"
	]

	private static readonly interpolators = <const>[
		"Linear",
		"Accel",
		"Deaccel",
		"Spline",
		"Pulse",
		"Flicker",
		"Gain",
		"Bias",
	]

	private static readonly colourProperties = new Set([
		"SelectedBoxColor",
		"SelectedFgColor",
		"TextColor",
		"Ammo2Color",
		"BgColor",
		"FgColor",
		"ItemColor",
		"MenuColor",
	].map((i) => i.toLowerCase()))

	public static definitionReferences(document: HUDAnimationsTextDocument, documentSymbols: HUDAnimationsDocumentSymbols) {
		const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
		const definitions = new Collection<Definition>()
		const references = new Collection<VDFText>()
		const elementReferences = new Map<string, Collection<VDFText>>()

		for (const documentSymbol of documentSymbols) {
			const documentation = document.definitions.documentation(documentSymbol)
			definitions.set(null, types.event, documentSymbol.eventName.text, {
				uri: document.uri,
				key: documentSymbol.eventName.text,
				range: documentSymbol.range,
				keyToken: documentSymbol.eventName,
				documentation: { kind: MarkupKind.Markdown, value: documentation },
				conditional: documentSymbol.conditional?.value,
				completionItem: {
					label: documentSymbol.eventName.text,
					kind: CompletionItemKind.Event,
					documentation: { kind: MarkupKind.Markdown, value: documentation }
				}
			})

			const eventName = documentSymbol.eventName.text.toLowerCase()

			let scope: number | null
			let paths: string[]

			if (((eventName): eventName is keyof typeof eventFiles => eventName in eventFiles)(eventName)) {
				scope = HUDAnimationsTextDocument.eventScopes.get(eventName)!

				scopes
					.getOrInsertComputed(types.element, () => new Map<number, VDFRange[]>())
					.getOrInsertComputed(scope, () => [])
					.push(documentSymbol.range)

				const eventFile = eventFiles[eventName]
				paths = Array.isArray(eventFile) ? eventFile : [eventFile]
			}
			else {
				scope = null
				paths = []
			}

			for (const path of paths) {
				elementReferences.getOrInsertComputed(path, () => new Collection<VDFText>())
			}

			for (const statement of documentSymbol.children) {
				if ("event" in statement) {
					references.set(null, types.event, statement.event.text, statement.event)
				}

				if ("element" in statement) {
					references.set(scope, types.element, statement.element.text, statement.element)
					for (const path of paths) {
						elementReferences.get(path)!.set(null, types.element, statement.element.text, statement.element)
					}
				}

				if (statement.type == HUDAnimationStatementType.Animate && HUDAnimationsTextDocument.colourProperties.has(statement.property.text.toLowerCase()) && types.colour.test(statement.value.text)) {
					references.set(null, types.colour, statement.value.text, statement.value)
				}

				if ("font" in statement) {
					references.set(null, types.font, statement.font.text, statement.font)
				}
			}
		}

		return {
			scopes,
			definitions,
			references,
			elementReferences,
		}
	}

	public readonly languageId = <const>"hudanimations"

	private readonly workspace: VDFWorkspace
	private readonly elementDependencies: Map<string, { path: string, uri: Uri, definitions: Definitions }>
	private readonly elementReferences: Map<string, { collection$: BehaviorSubject<Collection<VDFText>>, references$: BehaviorSubject<Map<string, References>>, remove: { remove(): void } }>

	protected getDiagnostics: (params: TextDocumentDiagnosticsParams<Dependencies, Globals, HUDAnimationsDocumentSymbols>) => void
	public readonly decorations$: Observable<Decoration[]>

	public constructor(
		init: TextDocumentInit,
		documentConfiguration$: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, TextDocument>,
		trpc: TRPCClient<ClientRouter>,
		workspace: VDFWorkspace,
		path: string | null,
	) {
		super(init, documentConfiguration$, fileSystem, documents, trpc, {
			path: path,
			getDocumentSymbols: (text: string) => getHUDAnimationsDocumentSymbols(text),
			defaultDocumentSymbols: new HUDAnimationsDocumentSymbols(),
			data$: of<TextDocumentData<Dependencies, Globals, HUDAnimationsDocumentSymbols>>({
				dependencies: {},
				globals: {
					clientScheme: workspace.clientScheme
				},
				content$: defer(() => {
					return workspace.HUDAnimations$.pipe(
						map((HUDAnimations) => ({ HUDAnimations: HUDAnimations, some: HUDAnimations.values().some((document) => Uri.equals(document.uri, this.uri)) })),
						distinctUntilChanged((previous, current) => previous.some == current.some),
						switchMap(({ HUDAnimations, some }) => {
							if (some) {
								const references = this.references.detach()
								const remove = workspace.setFileReferences("scripts/hudanimations_manifest.txt", this.uri, references)

								return combineLatest(HUDAnimations.map((file) => file.document$)).pipe(
									map((documents) => {
										const self = documents.find((document) => document != null && Uri.equals(document.uri, this.uri))
										if (!self) {
											throw new Error()
										}

										const version: number[] = []
										const definitions = new Collection<Definition>()

										for (const document of documents.values().filter((document) => document != null)) {
											version.push(document.version)

											// Copy event definitions to definitions, used for Go to Definition
											for (const [key, value] of document.definitionReferences.definitions.ofType(null, types.event)) {
												definitions.set(null, types.event, key, ...value)
											}
										}

										return {
											documentSymbols: self.documentSymbols,
											definitionReferences: {
												scopes: self.definitionReferences.scopes,
												definitions: new Definitions(version, definitions),
												references: self.definitionReferences.references,
												elementReferences: self.definitionReferences.elementReferences,
											}
										}
									}),
									finalize(() => remove.remove())
								)
							}
							else {
								return this.documentSymbols$.pipe(
									map((documentSymbols) => {
										const { scopes, definitions, references, elementReferences } = HUDAnimationsTextDocument.definitionReferences(this, documentSymbols)
										return {
											documentSymbols: documentSymbols,
											definitionReferences: {
												scopes: scopes,
												definitions: new Definitions([this.version], definitions),
												references: references,
												elementReferences: elementReferences
											}
										}
									}),
								)
							}
						}),
						map(({ documentSymbols, definitionReferences }) => {
							for (const [path, elementReferences] of this.elementReferences) {
								if (!definitionReferences.elementReferences.has(path)) {
									elementReferences.remove.remove()
									this.elementReferences.delete(path)
								}
							}

							for (const [path, collection] of definitionReferences.elementReferences) {
								this.elementReferences.getOrInsertComputed(path, () => {
									const collection$ = new BehaviorSubject(new Collection<VDFText>())
									const references$ = new BehaviorSubject(new Map<string, References>())

									return {
										collection$: collection$,
										references$: references$,
										remove: workspace.setFileReferences(path, this.uri, new References(this.uri, collection$, references$))
									}
								}).collection$.next(collection)
							}

							return {
								documentSymbols: documentSymbols,
								definitionReferences: definitionReferences,
								eventNames: new Set(
									documentSymbols
										.values()
										.map((documentSymbol) => documentSymbol.eventName.text.toLowerCase())
										.filter((eventName) => ((eventName): eventName is keyof typeof eventFiles => eventName in eventFiles)(eventName))
								),
							}
						}),
						combineLatestPersistent({
							entries: (value) => {
								return value.definitionReferences.elementReferences
									.keys()
									.map((path) => ({ key: path }))
									.toArray()
							},
							observableSelector: (entry) => {
								return workspace.elements(entry.key).pipe(
									map(({ uri, definitions }) => ({ path: entry.key, uri, definitions })),
								)
							},
							resultSelector: (value, results) => {
								const set = new Set(results.values().map((result) => result.path))
								for (const key of this.elementDependencies.keys()) {
									if (!set.has(key)) {
										this.elementDependencies.delete(key)
									}
								}

								for (const result of results) {
									this.elementDependencies.set(result.path, result)
								}

								const version = value.definitionReferences.definitions.version
								const definitions = value.definitionReferences.definitions.collection.clone()

								for (const eventName of value.eventNames) {
									const eventFile = eventFiles[eventName]
									const eventScope = HUDAnimationsTextDocument.eventScopes.get(eventName)!
									const paths = Array.isArray(eventFile) ? eventFile : [eventFile]

									// Copy element definitions to document, used for Go to Definition
									for (const path of paths) {
										const elementDefinitions = this.elementDependencies.get(path)!.definitions
										version.push(...elementDefinitions.version)
										for (const { scope: _scope, type, key, value } of elementDefinitions) {
											definitions.set(eventScope, type, key, ...value)
										}
									}
								}

								return {
									documentSymbols: value.documentSymbols,
									definitionReferences: {
										scopes: value.definitionReferences.scopes,
										definitions: new Definitions(version, definitions),
										references: value.definitionReferences.references
									},
								}
							},
						})
					)
				})
			}),
		})

		this.workspace = workspace
		this.elementDependencies = new Map()
		this.elementReferences = new Map()

		const sounds = new Map<string, Observable<Entry>>()

		const createBestDefinitionMatchCodeAction = (definitions: Definitions, type: DefinitionType, name: string, value: string, range: VDFRange, createDocumentWorkspaceEdit: (edit: TextEdit) => WorkspaceEdit) => {
			const definition = [...definitions.ofType(null, type).values()].map((definition) => definition[0].key)
			if (!definition.length) {
				return null
			}

			const match = findBestMatch(value, definition).bestMatch
			if (match.rating < 0.5) {
				return null
			}

			return {
				title: `Change ${name} to '${match.target}'`,
				edit: createDocumentWorkspaceEdit(TextEdit.replace(range, match.target))
			}
		}

		this.getDiagnostics = ({ dependencies: _dependencies, globals, content, diagnostics, subscriptions, dispose$, next }) => {
			const { documentSymbols, definitionReferences: { definitions } } = content

			const soundReferences = new Map<string, PartialDiagnosticCodeActionReference[]>()

			for (const documentSymbol of documentSymbols) {
				const eventName = documentSymbol.eventName.text.toLowerCase()
				const eventDefinitions = definitions.get(null, types.event, eventName)

				const definition = eventDefinitions?.find((definition) => definition.conditional?.toLowerCase() == documentSymbol.conditional?.value.toLowerCase())
				if (!definition || !Uri.equals(definition.uri, this.uri) || definition.keyToken != documentSymbol.eventName) {
					diagnostics.push({
						range: documentSymbol.range,
						severity: DiagnosticSeverity.Hint,
						code: "duplicate-event",
						source: "hudanimations",
						message: "Unreachable code detected.",
						tags: [
							DiagnosticTag.Unnecessary
						],
						relatedInformation: eventDefinitions?.map((definition) => ({
							location: {
								uri: definition.uri.toString(),
								range: definition.keyToken.range,
							},
							message: `${definition.key} is declared here.`
						})),
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: "Remove duplicate event",
									kind: CodeActionKind.QuickFix,
									isPreferred: true,
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							}
						}
					})
				}

				for (const statement of documentSymbol.children) {
					if ("event" in statement) {
						const definition = definitions.get(null, types.event, statement.event.text)
						if (!definition || !definition.length) {
							diagnostics.push({
								range: statement.event.range,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-reference",
								source: this.languageId,
								message: `Cannot find event '${statement.event.text}'.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return createBestDefinitionMatchCodeAction(
											definitions,
											types.event,
											"event",
											statement.event.text,
											statement.event.range,
											createDocumentWorkspaceEdit
										)
									}
								}
							})
						}
					}

					if ("element" in statement) {
						const eventName = documentSymbol.eventName.text.toLowerCase()
						if (((eventName): eventName is keyof typeof eventFiles => eventName in eventFiles)(eventName)) {
							const scope = HUDAnimationsTextDocument.eventScopes.get(eventName)!
							const definition = definitions.get(scope, types.element, statement.element.text)
							if (!definition || !definition.length) {
								const eventFile = eventFiles[eventName]
								diagnostics.push({
									range: statement.element.range,
									severity: DiagnosticSeverity.Warning,
									code: "invalid-reference",
									source: "hudanimations",
									message: `Cannot find element '${statement.element.text}'.`,
									relatedInformation: (Array.isArray(eventFile) ? eventFile : [eventFile]).map((path) => {
										return {
											location: {
												uri: this.elementDependencies.get(path)!.uri.toString(),
												range: new VDFRange(new VDFPosition(0, 0))
											},
											message: "Elements are declared here."
										}
									}),
									data: {
										fix: ({ createDocumentWorkspaceEdit }) => {
											return createBestDefinitionMatchCodeAction(
												definitions,
												types.element,
												"element",
												statement.element.text,
												statement.element.range,
												createDocumentWorkspaceEdit
											)
										}
									}
								})
							}
						}
					}

					if (statement.type == HUDAnimationStatementType.Animate) {
						if (HUDAnimationsTextDocument.colourProperties.has(statement.property.text.toLowerCase()) && types.colour.test(statement.value.text)) {
							const definition = globals.clientScheme.get(null, types.colour, statement.value.text)
							if (!definition || !definition.length) {
								diagnostics.push({
									range: statement.value.range,
									severity: DiagnosticSeverity.Warning,
									code: "invalid-reference",
									source: "hudanimations",
									message: `Cannot find colour '${statement.value.text}'.`,
									data: {
										fix: ({ createDocumentWorkspaceEdit }) => {
											return createBestDefinitionMatchCodeAction(
												definitions,
												types.colour,
												"colour",
												statement.value.text,
												statement.value.range,
												createDocumentWorkspaceEdit
											)
										}
									}
								})
							}
						}

						if (statement.interpolator.type == "Unknown") {
							const interpolator = statement.interpolator
							diagnostics.push({
								range: interpolator.range,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-interpolator",
								source: "hudanimations",
								message: `Invalid interpolator '${interpolator.value.text}'.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										const complexInterpolatorsParams: { [key: string]: string } = {
											"Bias": "bias",
											"Flicker": "randomness",
											"Gain": "bias",
											"Pulse": "frequency"
										}

										const complexInterpolators = Object.keys(complexInterpolatorsParams)
										const match = findBestMatch(interpolator.value.text, ["Accel", "Bounce", "DeAccel", "Linear", "Spline", ...complexInterpolators].toSorted())
										const newInterpolator = match.bestMatch.rating < 0.5
											? "Linear"
											: match.bestMatch.target

										const complex = complexInterpolators.includes(newInterpolator)
										const arg = "0"
										const newText = complex ? `${newInterpolator} ${arg}` : newInterpolator

										return {
											title: `Change interpolator to '${newInterpolator}'${complex ? ` with ${complexInterpolatorsParams[newInterpolator]} ${arg}` : ""}`,
											edit: createDocumentWorkspaceEdit(TextEdit.replace(interpolator.range, newText))
										}
									}
								}
							})
						}
					}

					if ("font" in statement) {
						const definition = definitions.get(null, types.font, statement.font.text)
						if (!definition || !definition.length) {
							diagnostics.push({
								range: statement.font.range,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-reference",
								source: "hudanimations",
								message: `Cannot find font '${statement.font.text}'.`,
								data: {
									fix: ({ createDocumentWorkspaceEdit }) => {
										return createBestDefinitionMatchCodeAction(
											definitions,
											types.font,
											"font",
											statement.font.text,
											statement.font.range,
											createDocumentWorkspaceEdit
										)
									}
								}
							})
						}
					}

					if ("sound" in statement) {
						const path = resolvePath(`sound/${statement.sound.text}`)
						soundReferences.getOrInsertComputed(path, () => []).push({ index: diagnostics.length, name: "sound", documentSymbolRange: statement.range, value: statement.sound })
						diagnostics.push(undefined)
					}
				}
			}

			for (const [path, values] of soundReferences) {
				subscriptions.push(
					sounds.getOrInsertComputed(
						path,
						() => this.fileSystem.resolve(path).pipe(
							finalize(() => sounds.delete(path)),
							share({ connector: () => new ReplaySubject(1), resetOnRefCountZero: () => dispose$ })
						)
					).subscribe((entry) => {
						switch (entry.type) {
							case EntryType.None: {
								for (const { index, value } of values) {
									diagnostics[index] = {
										range: value.range,
										severity: DiagnosticSeverity.Warning,
										source: "hudanimations",
										message: `Cannot find sound file '${value.text}'.`,
									}
								}
								break
							}
							case EntryType.File: {
								for (const { index } of values) {
									diagnostics[index] = null
								}
								break
							}
							case EntryType.Directory: {
								for (const { index, value } of values) {
									diagnostics[index] = {
										range: value.range,
										severity: DiagnosticSeverity.Warning,
										source: "hudanimations",
										message: `Sound file '${value.text}' references a directory.`,
									}
								}
								break
							}
						}

						next()
					})
				)
			}
		}

		this.decorations$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				return documentSymbols.reduce(
					(decorations, documentSymbol) => {
						const eventName = documentSymbol.eventName.text.toLowerCase()
						if (((eventName): eventName is keyof typeof eventFiles => eventName in eventFiles)(eventName)) {
							const eventFile = eventFiles[eventName]
							decorations.push({
								range: documentSymbol.conditional?.range ?? documentSymbol.eventName.range,
								renderOptions: {
									after: {
										contentText: Array.isArray(eventFile) ? eventFile.join(", ") : eventFile
									}
								}
							})
						}

						return decorations
					},
					<Decoration[]>[]
				)
			})
		)

		this.connect()
	}

	public async onDidOpenTextDocument(_server: VDFLanguageServer, _connection: Connection): Promise<AsyncDisposable> {
		void this.workspace.HUDAnimationsReferences()
		void this.workspace.VGUIReferences()
		return {
			[Symbol.asyncDispose]: async () => { }
		}
	}

	public async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
		await this.workspace.HUDAnimationsReferences()
		return await super.onCodeLens(params)
	}

	public async onDocumentFormatting(params: DocumentFormattingParams): Promise<string> {
		const documentFormattingConfiguration = (await firstValueFrom(this.documentConfiguration$)).hudanimations.format

		const options: HUDAnimationsFormatStringifyOptions = {
			layoutScope: documentFormattingConfiguration.layoutScope,
			tabs: documentFormattingConfiguration.tabs,
			breakAfterEvent: documentFormattingConfiguration.insertNewlineAfterEvents,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		return formatHUDAnimations(this.getText(), options)
	}

	public async getDocumentLinks(): Promise<DocumentLinkResolve[]> {
		const documentSymbols = await firstValueFrom(this.documentSymbols$)
		const documentLinks: DocumentLinkResolve[] = []
		documentSymbols.forAllStatements((statement) => {
			if (statement.type == HUDAnimationStatementType.PlaySound) {
				documentLinks.push({
					range: statement.sound.range,
					data: {
						resolve: async () => {
							const path = resolvePath(`sound/${statement.sound.text}`)
							return (await firstValueFrom(this.fileSystem.resolve(path))).uri
						}
					}
				})
			}
		})
		return documentLinks
	}

	public async getDocumentColor(): Promise<ColourInformationStringify[]> {
		return []
	}

	public async onInlayHint(_params: { range: VDFRange }): Promise<InlayHint[]> {
		return []
	}

	protected async getRename(params: VDFRenameParams): Promise<WorkspaceEdit> {
		if (params.type == types.event) {
			await this.workspace.HUDAnimationsReferences()
		}

		if (params.type == types.element || params.type == types.colour || params.type == types.font) {
			await this.workspace.VGUIReferences()
		}

		return await super.getRename({
			...params,
			scope: params.type == types.element && params.scope != null
				? null
				: params.scope
		})
	}

	protected async getCompletion(params: VDFCompletionParams): Promise<VDFCompletionList | null> {

		const text = (key: string, token: CompletionToken | undefined, getText: (text: string) => string = identity): Partial<VDFCompletionItem> => {
			const text = token?.quoted || quote(key) ? `"${key}"` : key
			return { textEditText: getText(text) }
		}

		const keywords = (token?: CompletionToken): VDFCompletionList => {
			return {
				token: token,
				length: HUDAnimationsTextDocument.keywords.length,
				items: HUDAnimationsTextDocument
					.keywords
					.values()
					.map((str) => ({ label: str, kind: CompletionItemKind.Keyword, ...text(str, token) }))
			}
		}

		const definitions = async (type: DefinitionType, global: keyof Globals | null, token?: CompletionToken): Promise<VDFCompletionList> => {
			const data = await firstValueFrom(this.data$)

			const [definitions, scope] = global == null
				? [data.content.definitionReferences.definitions, data.content.definitionReferences.scopes.get(type)?.entries().find(([_scope, ranges]) => ranges.some((range) => range.contains(params.position)))?.[0] ?? null]
				: [await firstValueFrom(data.globals.get(global).definitions$), null]

			const definition = definitions.ofType(scope, type)

			return {
				token: token,
				length: definition.size,
				items: definition
					.values()
					.filter((definition) => definition.length)
					.map((definition) => ({ ...definition[0].completionItem, ...text(definition[0].completionItem.label, token) }))
			}
		}

		const elements = async (token?: CompletionToken) => {
			if (!eventDocumentSymbol) {
				throw new Error("unreachable")
			}

			return await definitions(types.element, null, token)
		}

		const properties = (token?: CompletionToken): VDFCompletionList => {
			return {
				token: token,
				length: HUDAnimationsTextDocument.properties.length,
				items: HUDAnimationsTextDocument
					.properties
					.values()
					.map((key) => ({ label: key, kind: CompletionItemKind.Keyword, ...text(key, token) }))
			}
		}

		const fontProperties = (token?: CompletionToken): VDFCompletionList => {
			return {
				token: token,
				length: clientscheme.Fonts.length,
				items: clientscheme.Fonts
					.values()
					.map((key) => ({ label: key, kind: CompletionItemKind.Property, ...text(key, token) }))
			}
		}

		const colours = async (token?: CompletionToken): Promise<VDFCompletionList> => {
			return await definitions(types.colour, "clientScheme", token)
		}

		const fonts = async (token?: CompletionToken): Promise<VDFCompletionList> => {
			return await definitions(types.font, "clientScheme", token)
		}

		const interpolators = (token?: CompletionToken): VDFCompletionList => {
			return {
				token: token,
				length: HUDAnimationsTextDocument.interpolators.length,
				items: HUDAnimationsTextDocument
					.interpolators
					.values()
					.map((key) => ({ label: key, kind: CompletionItemKind.Interface, ...text(key, token) }))
			}
		}

		const numbers = (token?: CompletionToken): VDFCompletionList => {
			return {
				token: token,
				length: 10,
				items: Array
					.from({ length: 10 }, (_, index) => (index * 0.1).toFixed(1))
					.values()
					.map((key) => ({ label: key, kind: CompletionItemKind.Unit, ...text(key, token) }))
			}
		}

		const events = async (token?: CompletionToken): Promise<VDFCompletionList> => {
			return await definitions(types.event, null, token)
		}

		const sounds = async (token?: CompletionToken) => {
			return await params.files({ folder: "sound", params: params, token: token })
		}

		const documentSymbols = await firstValueFrom(this.documentSymbols$)
		const eventDocumentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(params.position))

		if (!eventDocumentSymbol) {
			return {
				token: params.tokens[0],
				length: 1,
				items: [
					{
						label: "event",
						labelDetails: { description: "{}" },
						kind: CompletionItemKind.Keyword,
						insertTextFormat: InsertTextFormat.Snippet,
						...text("event", params.tokens[0], (text) => `${text} $1\n{\n\t$0\n}`),
					}
				]
			}
		}

		if (params.tokens.length == 0) {
			return keywords()
		}
		else if (params.tokens.length == 1 && params.includes(params.tokens[0])) {
			return keywords(params.tokens[0])
		}

		switch (params.tokens[0].value.toLowerCase()) {
			case "event": {
				switch (params.tokens.length) {
					case 2:
						return params.includes(params.tokens[1])
							? null
							: params.conditionals()
					case 3:
						return params.includes(params.tokens[2])
							? params.conditionals(params.tokens[2])
							: null
					default:
						return null
				}
			}
			case "animate": {
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: properties()
					case 3:
						return params.includes(params.tokens[2])
							? properties(params.tokens[2])
							: HUDAnimationsTextDocument.colourProperties.has(params.tokens[2].value.toLowerCase()) ? await colours() : null
					case 4:
						return params.includes(params.tokens[3])
							? HUDAnimationsTextDocument.colourProperties.has(params.tokens[2].value.toLowerCase()) ? await colours(params.tokens[3]) : null
							: interpolators()
					case 5:
						return params.includes(params.tokens[4])
							? interpolators(params.tokens[4])
							: numbers() /* delay */
					case 6:
						return params.includes(params.tokens[5])
							? numbers(params.tokens[5]) /* delay */
							: numbers() /* duration */
					case 7:
						return params.includes(params.tokens[6])
							? numbers(params.tokens[6]) /* duration */
							: params.conditionals()
					case 8:
						return params.includes(params.tokens[7])
							? params.conditionals(params.tokens[7])
							: null
					default:
						return null
				}
			}
			case "runevent":
			case "stopevent": {
				switch (params.tokens.length) {
					case 1:
						return await events()
					case 2:
						return params.includes(params.tokens[1])
							? await events(params.tokens[1])
							: numbers() /* delay */
					case 3:
						return params.includes(params.tokens[2])
							? numbers(params.tokens[2]) /* delay */
							: params.conditionals()
					case 4:
						return params.includes(params.tokens[3])
							? params.conditionals(params.tokens[3])
							: null
					default:
						return null
				}
			}
			case "setvisible":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: params.bits() /* visible */
					case 3:
						return params.includes(params.tokens[2])
							? params.bits() /* visible */
							: numbers() /* delay */
					case 4:
						return params.includes(params.tokens[3])
							? numbers(params.tokens[3]) /* delay */
							: params.conditionals()
					case 5:
						return params.includes(params.tokens[4])
							? params.conditionals(params.tokens[4])
							: null
					default:
						return null
				}
			case "firecommand":
				switch (params.tokens.length) {
					case 1:
						return numbers() /* delay */
					case 2:
						return params.includes(params.tokens[1])
							? numbers(params.tokens[1]) /* delay */
							: null /* command */
					case 3:
						return params.includes(params.tokens[2])
							? null /* command */
							: params.conditionals() /* delay */
					case 4:
						return params.includes(params.tokens[3])
							? params.conditionals(params.tokens[3]) /* conditionals */
							: null
					default:
						return null
				}
			case "runeventchild":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: await events()
					case 3:
						return params.includes(params.tokens[2])
							? await events(params.tokens[2])
							: numbers() /* delay */
					case 4:
						return params.includes(params.tokens[3])
							? numbers(params.tokens[3]) /* delay */
							: params.conditionals()
					case 5:
						return params.includes(params.tokens[4])
							? params.conditionals(params.tokens[4])
							: null
					default:
						return null
				}
			case "setinputenabled":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: params.bits() /* enabled */
					case 3:
						return params.includes(params.tokens[2])
							? params.bits() /* enabled */
							: numbers() /* delay */
					case 4:
						return params.includes(params.tokens[3])
							? numbers(params.tokens[3]) /* delay */
							: params.conditionals()
					case 5:
						return params.includes(params.tokens[4])
							? params.conditionals(params.tokens[4])
							: null
					default:
						return null
				}
			case "playsound":
				switch (params.tokens.length) {
					case 1:
						return numbers() /* delay */
					case 2:
						return params.includes(params.tokens[1])
							? numbers(params.tokens[1]) /* delay */
							: await sounds()
					case 3:
						return params.includes(params.tokens[2])
							? await sounds(params.tokens[2])
							: params.conditionals()
					case 4:
						return params.includes(params.tokens[3])
							? params.conditionals(params.tokens[3])
							: null
					default:
						return null
				}
			case "stoppanelanimations":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: numbers() /* delay */
					case 3:
						return params.includes(params.tokens[2])
							? numbers(params.tokens[2]) /* delay */
							: params.conditionals()
					case 4:
						return params.includes(params.tokens[3])
							? params.conditionals(params.tokens[3])
							: null
					default:
						return null
				}
			case "setfont":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: fontProperties()
					case 3:
						return params.includes(params.tokens[2])
							? fontProperties(params.tokens[2])
							: await fonts()
					case 4:
						return params.includes(params.tokens[3])
							? await fonts(params.tokens[3])
							: numbers() /* delay */
					case 5:
						return params.includes(params.tokens[4])
							? numbers(params.tokens[4]) /* delay */
							: params.conditionals()
					case 6:
						return params.includes(params.tokens[5])
							? params.conditionals(params.tokens[5])
							: null
					default:
						return null
				}
			case "settexture":
			case "setstring":
				switch (params.tokens.length) {
					case 1:
						return await elements()
					case 2:
						return params.includes(params.tokens[1])
							? await elements(params.tokens[1])
							: null /* property */
					case 3:
						return params.includes(params.tokens[2])
							? null /* property */
							: null /* value */
					case 4:
						return params.includes(params.tokens[3])
							? null /* value */
							: numbers() /* delay */
					case 5:
						return params.includes(params.tokens[4])
							? numbers(params.tokens[4]) /* delay */
							: params.conditionals()
					case 6:
						return params.includes(params.tokens[5])
							? params.conditionals(params.tokens[5])
							: null
					default:
						return null
				}
			default:
				return null
		}
	}
}
