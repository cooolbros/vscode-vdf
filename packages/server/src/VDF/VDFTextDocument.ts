import type { TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { type CompletionToken } from "common/generateTokens"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { defer, firstValueFrom, identity, map, Observable, of, startWith } from "rxjs"
import { VDFIndentation, VDFNewLine, VDFRange, type VDFParserOptions } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { formatVDF, quote, type VDFFormatStringifyOptions } from "vdf-format"
import { CompletionItemKind, InsertTextFormat, type CodeLens, type CodeLensParams, type Connection, type DocumentFormattingParams, type InlayHint, type WorkspaceEdit } from "vscode-languageserver"
import type { VDFTextDocumentLike } from "../BaseDocument"
import { Collection, Definitions, type Definition } from "../DefinitionReferences"
import type { DefinitionType } from "../DefinitionTypes"
import type { DiagnosticsContext } from "../DiagnosticFactory"
import type { ColourInformationStringify, Decoration, DocumentLinkResolve, PartialDiagnosticCodeAction, TextDocumentContent, TextDocumentDiagnosticsParams, TextDocumentInit, VDFCompletionItem, VDFCompletionList, VDFCompletionParams, VDFRenameParams } from "../TextDocumentBase"
import { TextDocumentBase } from "../TextDocumentBase"
import { type TextDocument, type VDFLanguageServer } from "../VDFLanguageServer"
import { VDFFileType, VDFWorkspace, type GlobalDefinitionReferences } from "../VDFWorkspace"
import { ClientSchemeSchema } from "./schemas/ClientSchemeSchema"
import { GameMenuSchema } from "./schemas/GameMenuSchema"
import { GameSoundsManifestSchema } from "./schemas/GameSoundsManifestSchema"
import { GameSoundsSchema } from "./schemas/GameSoundsSchema"
import { HUDAnimationsManifestSchema } from "./schemas/HUDAnimationsManifestSchema"
import { ItemsGameSchema } from "./schemas/ItemsGameSchema"
import { LanguageTokensSchema } from "./schemas/LanguageTokensSchema"
import { SurfacePropertiesManifestSchema } from "./schemas/SurfacePropertiesManifestSchema"
import { SurfacePropertiesSchema } from "./schemas/SurfacePropertiesSchema"
import { VGUISchema } from "./schemas/VGUISchema"

export interface Dependencies {
	readonly schema: VDFTextDocumentSchemaResult
}

export interface Globals extends Record<string, GlobalDefinitionReferences> {
}

export interface VDFTextDocumentSchema {
	readonly id: string
	readonly name: string
	readonly definitionTypes: { type: DefinitionType, keys: Set<string> }[]
	readonly content$: Observable<TextDocumentContent<VDFDocumentSymbols>>
	getDiagnostics(diagnostics: PartialDiagnosticCodeAction[], context: DiagnosticsContext<Dependencies, Globals, VDFDocumentSymbols>): void
	getDocumentLinks(): Promise<DocumentLinkResolve[]>
	getDocumentColor(): Promise<ColourInformationStringify[]>
	onInlayHint(params: { range: VDFRange }): Promise<InlayHint[]>
	completion: {
		keys: Parameters<(typeof VDFTextDocument)["getCompletion"]>[2],
		values: Parameters<(typeof VDFTextDocument)["getCompletion"]>[3],
	}
	[key: string]: unknown
}

type VDFTextDocumentSchemaResult = (
	| ReturnType<typeof ClientSchemeSchema>
	| ReturnType<typeof GameMenuSchema>
	| ReturnType<typeof GameSoundsManifestSchema>
	| ReturnType<typeof GameSoundsSchema>
	| ReturnType<typeof HUDAnimationsManifestSchema>
	| ReturnType<typeof ItemsGameSchema>
	| ReturnType<typeof LanguageTokensSchema>
	| ReturnType<typeof SurfacePropertiesManifestSchema>
	| ReturnType<typeof SurfacePropertiesSchema>
	| ReturnType<typeof VGUISchema>
)

export class VDFTextDocument extends TextDocumentBase<Dependencies, Globals, VDFDocumentSymbols> {

	public static async getCompletion(
		document: VDFTextDocumentLike,
		params: VDFCompletionParams,
		keys: (params: VDFCompletionParams, path: VDFDocumentSymbol[], token?: CompletionToken) => Promise<{ before?: VDFCompletionItem[], field?: { kind?: CompletionItemKind, one?: string[], many?: string[], values?: { [key: string]: string[] } }, cls?: { one?: string[], many?: string[] }, after?: VDFCompletionItem[], } | null>,
		values: (params: VDFCompletionParams, path: VDFDocumentSymbol[], key: string, token?: CompletionToken) => Promise<VDFCompletionList | null>
	): Promise<VDFCompletionList | null> {

		const add = (documentSymbols: VDFDocumentSymbols) => {
			const path: VDFDocumentSymbol[] = []
			const documentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(params.position))
			if (documentSymbol != undefined) {
				if (documentSymbol.children != undefined) {
					path.push(documentSymbol)
					path.push(...add(documentSymbol.children))
				}
			}
			return path
		}

		const _keys = async (token?: CompletionToken): Promise<VDFCompletionList | null> => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const path = add(documentSymbols)
			const set = new Set((path.at(-1)?.children ?? documentSymbols).map((documentSymbol) => documentSymbol.key.text.toLowerCase()))

			const result = await keys(params, path, token)
			if (result == null) {
				return null
			}

			const { before = [], field, cls, after = [] } = result
			const fieldKind = field?.kind ?? CompletionItemKind.Field
			const fieldValues = field?.values ?? {}

			const fieldItem = (field: string): VDFCompletionItem => {
				const quoted = token?.quoted || quote(field)
				const text = quoted ? `"${field}"` : field

				let textEditText: VDFCompletionItem["textEditText"]
				let insertTextFormat: VDFCompletionItem["insertTextFormat"]
				let command: VDFCompletionItem["command"]

				const fieldLower = field.toLowerCase()
				const values = Object.entries((fieldValues)).find(([key, _values]) => key.toLowerCase() == fieldLower)?.[1]
				if (values != undefined) {
					const q = quoted ? `"` : ``

					if (values.length == 1) {
						textEditText = `${text}\t\t${q}${values[0]}${q}`
					}
					else if (values.length == 2 && values[0] == "1" && values[1] == "0") {
						// Ignore values where values[0] == "0" && values[1] == "1"
						textEditText = `${text}\t\t${q}${values[0]}${q}`
					}
					else if (values.length < 64) {
						// https://code.visualstudio.com/docs/editing/userdefinedsnippets#_choice
						textEditText = `${text}\t\t${q}$\{1|${values.join(",")}|}${q}`
						insertTextFormat = InsertTextFormat.Snippet
					}
					else {
						textEditText = `${text}\t\t${q}$0${q}`
						insertTextFormat = InsertTextFormat.Snippet
						command = {
							title: "Trigger Suggest",
							command: "editor.action.triggerSuggest"
						}
					}
				}
				else {
					textEditText = quoted ? `"${field}"` : field
					insertTextFormat = InsertTextFormat.PlainText
				}

				return {
					label: field,
					kind: fieldKind,
					textEditText: textEditText,
					insertTextFormat: insertTextFormat,
					command: command,
				}
			}

			const clsItem = (cls: string): VDFCompletionItem => {
				const quoted = token?.quoted || quote(cls)
				const textEditText = `${quoted ? `"${cls}"` : cls}\n{\n\t$0\n}`
				return {
					label: cls,
					labelDetails: { description: "{}" },
					kind: CompletionItemKind.Class,
					textEditText: textEditText,
					insertTextFormat: InsertTextFormat.Snippet,
				}
			}

			const entries = function*() {
				yield* (field?.one ?? []).filter((field) => !set.has(field.toLowerCase())).map(fieldItem)
				yield* (field?.many ?? []).values().map(fieldItem)
				yield* (cls?.one ?? []).values().filter((cls) => !set.has(cls.toLowerCase())).map(clsItem)
				yield* (cls?.many ?? []).values().map(clsItem)
			}

			return {
				token: token,
				length: (field?.one?.length ?? 0) + (field?.many?.length ?? 0) + (cls?.one?.length ?? 0) + (cls?.many?.length ?? 0),
				items: (function*() {
					yield* before
					yield* entries()
					yield* after
				})()
			}
		}

		const _values = async (key: string, token?: CompletionToken): Promise<VDFCompletionList | null> => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const path = add(documentSymbols)

			const result = await values(params, path, key, token)
			if (result == null) {
				return null
			}

			const map = result.token instanceof VDFRange
				? identity
				: (item: VDFCompletionItem) => {
					const text = item.textEditText ?? item.label
					if (token?.quoted || quote(text)) {
						item.textEditText = `"${text}"`
					}
					return item
				}

			return {
				token: result.token ?? token,
				length: result.length,
				items: Iterator.from(result.items).map(map)
			}
		}

		switch (params.tokens.length) {
			case 0: {
				return await _keys()
			}
			case 1: {
				const [key] = params.tokens
				if (params.includes(key)) {
					return await _keys(key)
				}
				else {
					return await _values(key.value)
				}
			}
			case 2: {
				const [key, value] = params.tokens
				if (params.includes(value)) {
					return await _values(key.value, value)
				}
				else {
					return params.conditionals()
				}
			}
			case 3: {
				const [_key, _value, conditional] = params.tokens
				if (params.includes(conditional)) {
					return params.conditionals(conditional)
				}
				else {
					return null
				}
			}
			default: {
				return null
			}
		}
	}

	public readonly languageId = <const>"vdf"

	public readonly workspace: VDFWorkspace
	public readonly VDFParserOptions: VDFParserOptions
	public readonly schema$: Observable<{ schema: VDFTextDocumentSchemaResult, globals: Globals }>

	protected getDiagnostics: (params: TextDocumentDiagnosticsParams<Dependencies, Globals, VDFDocumentSymbols>) => void
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
			getDocumentSymbols: (text) => getVDFDocumentSymbols(text, this.VDFParserOptions),
			defaultDocumentSymbols: new VDFDocumentSymbols(),
			data$: defer(() => this.schema$).pipe(
				map((dependencies) => {
					return {
						dependencies: {
							schema: dependencies.schema
						},
						globals: dependencies.globals,
						content$: dependencies.schema.content$,
					}
				}),
			)
		})

		this.workspace = workspace

		this.VDFParserOptions = {
			multilineStrings: (() => {
				if (path == "resource/gamemenu.res") {
					return new Set(["command"])
				}
				else if (/(tf|chat)_.*?\.txt/.test(init.uri.basename())) {
					return true
				}
				else {
					return false
				}
			})()
		}

		this.schema$ = defer(() => {
			if (path != null) {
				return workspace.fileType(path)
			}

			return of(VDFFileType.None)
		}).pipe(
			map((type) => {
				let schema: VDFTextDocumentSchemaResult
				let globals: Globals

				switch (type) {
					case VDFFileType.None:
						schema = VGUISchema(this)
						globals = { languageTokens: workspace.languageTokens, clientScheme: workspace.clientScheme }
						break
					case VDFFileType.ClientScheme:
						schema = ClientSchemeSchema(this)
						if (path?.toLowerCase() != "resource/clientscheme.res") {
							globals = {
								clientScheme: {
									definitions$: workspace.clientScheme.definitions$.pipe(
										map((definitions) => {
											// Don't add clientscheme definitions already declared in current .res file
											const collection = new Collection<Definition>()
											for (const { scope, type, key, value } of definitions) {
												const rest = value.filter((definition) => !Uri.equals(definition.uri, this.uri))
												if (rest.length > 0) {
													collection.set(scope, type, key, ...rest)
												}
											}

											return new Definitions(definitions.version, collection)
										}),
										startWith(new Definitions([], new Collection<Definition>())),
										shareReplayUntilDisposed(this.dispose$),
									),
									setReferences: (uri, references) => {
										return workspace.clientScheme.setReferences!(uri, references)
									}
								}
							}
						}
						else {
							globals = {}
						}
						break
					case VDFFileType.SourceScheme:
						schema = ClientSchemeSchema(this)
						globals = {}
						break
					case VDFFileType.ChatScheme:
						schema = ClientSchemeSchema(this)
						globals = {}
						break
					case VDFFileType.LanguageTokens:
						schema = LanguageTokensSchema(this)
						globals = {}
						break
					case VDFFileType.GameMenu:
						schema = GameMenuSchema(this)
						globals = { languageTokens: workspace.languageTokens }
						break
					case VDFFileType.ItemsGame:
						schema = ItemsGameSchema(this)
						globals = { languageTokens: workspace.languageTokens, clientScheme: workspace.clientScheme }
						break
					case VDFFileType.HUDAnimationsManifest:
						schema = HUDAnimationsManifestSchema(this)
						globals = {}
						break
					case VDFFileType.GameSoundsManifest:
						schema = GameSoundsManifestSchema(this)
						globals = {}
						break
					case VDFFileType.GameSounds:
						schema = GameSoundsSchema(this)
						globals = {}
						break
					case VDFFileType.SurfacePropertiesManifest:
						schema = SurfacePropertiesManifestSchema(this)
						globals = {}
						break
					case VDFFileType.SurfaceProperties:
						schema = SurfacePropertiesSchema(this)
						globals = {}
						break
					default:
						throw new Error("unreachable")
				}

				return {
					schema,
					globals,
				}
			}),
			shareReplayUntilDisposed(this.dispose$),
		)

		this.getDiagnostics = ({ diagnostics, ...params }) => {
			params.dependencies.schema.getDiagnostics(diagnostics, params)
		}

		this.decorations$ = of([])

		this.connect()
	}

	public async onDidOpenTextDocument(_server: VDFLanguageServer, _connection: Connection): Promise<AsyncDisposable> {
		void this.workspace.VGUIReferences()
		return {
			[Symbol.asyncDispose]: async () => { }
		}
	}

	public async onCodeLens(params: CodeLensParams): Promise<CodeLens[]> {
		await this.workspace.VGUIReferences()
		return await super.onCodeLens(params)
	}

	public async onDocumentFormatting(params: DocumentFormattingParams): Promise<string> {
		const documentFormattingConfiguration = (await firstValueFrom(this.documentConfiguration$)).vdf.format

		const options: VDFFormatStringifyOptions = {
			indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
			insertNewlineBeforeObjects: documentFormattingConfiguration.insertNewlineBeforeObjects,
			quotes: documentFormattingConfiguration.quotes,
			tabSize: params.options.tabSize,
			tabs: documentFormattingConfiguration.tabs,
			newLine: VDFNewLine.LF,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		return formatVDF(this.getText(), this.VDFParserOptions, options)
	}

	public async getDocumentLinks(): Promise<DocumentLinkResolve[]> {
		const { schema } = await firstValueFrom(this.schema$)
		return await schema.getDocumentLinks()
	}

	public async getDocumentColor(): Promise<ColourInformationStringify[]> {
		const { schema } = await firstValueFrom(this.schema$)
		return await schema.getDocumentColor()
	}

	public async onInlayHint(params: { range: VDFRange }): Promise<InlayHint[]> {
		const { schema } = await firstValueFrom(this.schema$)
		return await schema.onInlayHint(params)
	}

	protected async getRename(params: VDFRenameParams): Promise<WorkspaceEdit> {
		await this.workspace.VGUIReferences()
		return await super.getRename(params)
	}

	protected async getCompletion(params: VDFCompletionParams): Promise<VDFCompletionList | null> {
		const { schema } = await firstValueFrom(this.schema$)
		return await VDFTextDocument.getCompletion(
			this,
			params,
			schema.completion.keys,
			schema.completion.values,
		)
	}
}
