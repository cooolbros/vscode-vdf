import type { initTRPC, TRPCCombinedDataTransformer } from "@trpc/server"
import { generateTokens } from "common/generateTokens"
import { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import type { VSCodeVDFLanguageID, VSCodeVDFLanguageNameSchema } from "common/VSCodeVDFLanguageID"
import { posix } from "path"
import { firstValueFrom, type Observable } from "rxjs"
import { VDFIndentation, VDFNewLine, VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { formatVDF, type VDFFormatStringifyOptions } from "vdf-format"
import { Color, CompletionItem, CompletionItemKind, Hover, InlayHint, InlayHintRequest, Range, TextEdit, type ColorPresentationParams, type Connection, type DocumentColorParams, type DocumentFormattingParams, type HoverParams, type InlayHintParams, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { LanguageServer, type CompletionFiles, type TextDocumentRequestParams } from "../LanguageServer"
import { TextDocumentBase, type TextDocumentInit } from "../TextDocumentBase"
import { resolveFileDetail, VGUIAssetType, type VDFTextDocument, type VDFTextDocumentDependencies } from "./VDFTextDocument"

export interface VDFLanguageServerConfiguration<TDocument extends VDFTextDocument<TDocument>> {
	name: "popfile" | "vdf" | "vmt"
	servers: Set<VSCodeVDFLanguageID>
	capabilities: ServerCapabilities
	createDocument(init: TextDocumentInit, documentConfiguration$: Observable<VSCodeVDFConfiguration>, refCountDispose: (dispose: () => void) => void): Promise<TDocument>
}

export abstract class VDFLanguageServer<
	TLanguageId extends Extract<VSCodeVDFLanguageID, "popfile" | "vdf" | "vmt">,
	TDocument extends VDFTextDocument<TDocument>,
> extends LanguageServer<TLanguageId, TDocument, VDFDocumentSymbols, VDFTextDocumentDependencies> {

	protected readonly VDFLanguageServerConfiguration: VDFLanguageServerConfiguration<TDocument>

	private readonly documentsColours: Map<string, Map<string, (colour: Color) => string>>

	constructor(languageId: TLanguageId, name: z.infer<typeof VSCodeVDFLanguageNameSchema>[TLanguageId], connection: Connection, VDFLanguageServerConfiguration: VDFLanguageServerConfiguration<TDocument>) {
		super(languageId, name, connection, {
			servers: new Set(["vmt", ...VDFLanguageServerConfiguration.servers]),
			capabilities: {
				...VDFLanguageServerConfiguration.capabilities,
				hoverProvider: true,
				colorProvider: true,
				inlayHintProvider: true,
			},
			createDocument: async (init, documentConfiguration$, refCountDispose) => await VDFLanguageServerConfiguration.createDocument(init, documentConfiguration$, refCountDispose)
		})

		this.VDFLanguageServerConfiguration = VDFLanguageServerConfiguration
		this.documentsColours = new Map()

		this.onTextDocumentRequest(this.connection.onHover, this.onHover)
		this.onTextDocumentRequest(this.connection.onDocumentColor, this.onDocumentColor)
		this.onTextDocumentRequest(this.connection.onColorPresentation, this.onColorPresentation)
		this.connection.onRequest(InlayHintRequest.method, async (params: InlayHintParams): Promise<InlayHint[]> => {
			using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await firstValueFrom(document.inlayHints$)
		})
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>) {
		return super.router(t)
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<TDocument>): Promise<{ onDidClose: () => void }> {
		const { onDidClose } = await super.onDidOpen(event)
		return {
			onDidClose: () => {
				onDidClose()

				const key = event.document.uri.toString()
				this.documentsColours.delete(key)
			}
		}
	}

	protected async getCompletion(document: TDocument, position: VDFPosition, files: CompletionFiles): Promise<CompletionItem[] | null> {

		const keys = async (text?: string) => {

			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const documentSymbol = documentSymbols.getDocumentSymbolAtPosition(position)

			const schema = (await firstValueFrom(document.configuration.dependencies$)).schema

			if (!documentSymbol) {
				return [
					{
						label: "#base",
						kind: CompletionItemKind.Keyword,
					},
					...schema.completion.root.filter((item) => !documentSymbols.some((i) => i.key == item.label))
				]
			}
			else {
				function add(documentSymbols: VDFDocumentSymbols) {
					const path: VDFDocumentSymbol[] = []
					const documentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(position))
					if (documentSymbol != undefined) {
						path.push(documentSymbol)
						if (documentSymbol.children != undefined) {
							path.push(...add(documentSymbol.children))
						}
					}
					return path
				}

				const type = add(documentSymbols)
					.reverse()
					.values()
					.map(
						schema.completion.typeKey
							? (documentSymbol) => documentSymbol.children?.find((d) => d.key.toLowerCase() == schema.completion.typeKey)?.detail?.toLowerCase()
							: (documentSymbol) => documentSymbol.key.toLowerCase()
					)
					.find((type) => type != undefined && type in schema.keys)
					?? schema.completion.defaultType

				if (!type) {
					return null
				}

				const include = (k: string): CompletionItem[] => {
					const value = schema.keys[k]
					// @ts-ignore
					return [
						...(value.reference ? value.reference.flatMap(include) : []),
						...value.values?.filter((value) => (text ? value.label.toLowerCase().startsWith(text.toLowerCase()) : true) && (value.multiple ? true : !documentSymbol.children?.some((d) => d.key.toLowerCase() == value.label.toLowerCase()))) ?? []
					]
				}

				return include(type)
			}
		}

		const values = async (key: string, text?: string): Promise<CompletionItem[] | null> => {
			if (key == "#base") {
				const basename = document.uri.basename()
				const documentSymbols = await firstValueFrom(document.documentSymbols$)
				return await files(document.configuration.relativeFolderPath ?? "", {
					value: text ?? null,
					extensionsPattern: null,
					callbackfn: (name, type) => {
						return name == basename || documentSymbols.some((documentSymbol) => documentSymbol.key.toLowerCase() == "#base" && documentSymbol.detail == name)
							? null
							: {}
					},
				})
			}

			key = document.configuration.keyTransform(key.toLowerCase())

			const schema = (await firstValueFrom(document.configuration.dependencies$)).schema

			// Static
			const valueData = schema.values[key] ?? schema.completion.values?.[key]
			if (valueData != undefined) {
				return valueData
					.values
					.values()
					.filter((value) => text ? value.toLowerCase().startsWith(text.toLowerCase()) : true)
					.map((value, index) => ({
						label: value,
						kind: <CompletionItemKind>valueData.kind,
						...(valueData.enumIndex && {
							detail: `${index}`
						})
					}))
					.toArray()
			}

			// Dynamic
			const definitionReferencesConfiguration = schema
				.definitionReferences
				.values()
				.filter((definitionReference): definitionReference is typeof definitionReference & { reference: NonNullable<typeof definitionReference["reference"]> } => definitionReference.reference != undefined)
				.find(({ reference: { keys } }) => keys.has(key))

			if (definitionReferencesConfiguration != undefined) {
				const definitionReferences = await firstValueFrom(document.definitionReferences$)
				return definitionReferences.definitions.ofType(definitionReferencesConfiguration.type)
					.values()
					.filter((value) => value.length)
					.filter((value) => text ? value[0].key.toLowerCase().startsWith(text.toLowerCase()) : true)
					.map((value) => ({
						label: value[0].key,
						kind: CompletionItemKind.Variable,
						...(definitionReferencesConfiguration.toCompletionItem && {
							...definitionReferencesConfiguration.toCompletionItem(value[0])
						})
					} satisfies CompletionItem))
					.toArray()
			}

			// Files
			const fileConfiguration = schema.files.find(({ keys }) => keys.has(key))
			if (fileConfiguration != undefined) {
				return await files(fileConfiguration.folder, {
					value: text ?? null,
					extensionsPattern: fileConfiguration.extensionsPattern,
					callbackfn: fileConfiguration.toCompletionItem != null
						? (name, type) => fileConfiguration.toCompletionItem!(name, type, () => {
							const { dir, name: nameNoExt } = posix.parse(name)
							return posix.join(dir, nameNoExt)
						})
						: undefined,
					image: fileConfiguration.asset == VGUIAssetType.Image
				})
			}

			// Colours
			if (schema.colours.completion && schema.colours.keys) {

				const include = schema.colours.keys.include != null
					? schema.colours.keys.include.has(key)
					: true

				const exclude = schema.colours.keys.exclude != null
					? schema.colours.keys.exclude.has(key)
					: false

				if (include && !exclude) {
					return schema.colours.completion.presets
				}
			}

			return null
		}

		const conditionals = (text?: string) => {
			const [before, after] = document.getText(new VDFRange(
				position.with({ character: position.character - 1 }),
				position.with({ character: position.character + 1 }),
			))

			const start = before == "[" ? 1 : 0
			const end = after == "]" ? -1 : undefined

			return TextDocumentBase
				.conditionals
				.values()
				.filter((conditional) => text ? conditional.toLowerCase().startsWith(text.toLowerCase()) : true)
				.map((conditional) => {
					return {
						label: conditional,
						kind: CompletionItemKind.Variable,
						insertText: conditional.slice(start, end)
					} as CompletionItem
				})
				.toArray()
		}

		const line = document.getText({ start: { line: position.line, character: 0 }, end: position })
		const tokens = Array.from(generateTokens(line))

		// Remove tokens before and including opening brace,
		// so we suggest for the innermost key
		// https://github.com/cooolbros/vscode-vdf/issues/48
		tokens.splice(0, tokens.lastIndexOf("{") + 1)

		switch (tokens.length) {
			case 0: {
				return keys()
			}
			case 1: {
				const [key] = tokens
				if (line.endsWith(key)) {
					return keys(key)
				}
				else {
					return values(key)
				}
			}
			case 2: {
				const [key, value] = tokens
				if (line.endsWith(value)) {
					return values(key, value)
				}
				else {
					return conditionals()
				}
			}
			case 3: {
				const [key, value, conditional] = tokens
				if (line.endsWith(conditional)) {
					return conditionals(conditional)
				}
				else {
					return null
				}
			}
			default:
				return null
		}
	}

	private async onHover(params: TextDocumentRequestParams<HoverParams>): Promise<Hover | null> {
		using document = await this.documents.get(params.textDocument.uri)
		const documentSymbols = await firstValueFrom(document.documentSymbols$)

		const documentSymbol = documentSymbols.getDocumentSymbolAtPosition(params.position)
		if (!documentSymbol || !documentSymbol.detailRange || !documentSymbol.detailRange.contains(params.position)) {
			return null
		}

		const schema = (await firstValueFrom(document.configuration.dependencies$)).schema
		const key = document.configuration.keyTransform(documentSymbol.key.toLowerCase())

		const fileSchema = schema.files.find(({ keys }) => keys.has(key))
		if (!fileSchema) {
			return null
		}

		if (fileSchema.asset == VGUIAssetType.Image) {
			const path = resolveFileDetail(documentSymbol.detail!, fileSchema)
			const uri = await this.VTFToPNG(document.uri, path)
			if (uri) {
				return {
					contents: `![](${uri})`,
					range: documentSymbol.detailRange
				}
			}
		}

		return null
	}

	private async onDocumentColor(params: TextDocumentRequestParams<DocumentColorParams>) {

		using document = await this.documents.get(params.textDocument.uri)
		const colours = await firstValueFrom(document.colours$)

		this.documentsColours.set(
			params.textDocument.uri.toString(),
			new Map(colours.map(({ range, stringify }) => [`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`, stringify]))
		)

		return colours
	}

	private async onColorPresentation(params: TextDocumentRequestParams<ColorPresentationParams>) {
		const { color: colour, range } = params

		const stringify = this.documentsColours
			.get(params.textDocument.uri.toString())
			?.get(`${range.start.line}.${range.start.character}.${range.end.line}.${range.end.character}`)

		if (stringify == undefined) {
			return null
		}

		return [{ label: stringify(colour) }]
	}

	protected async onDocumentFormatting(document: TDocument, params: TextDocumentRequestParams<DocumentFormattingParams>): Promise<TextEdit[]> {

		const documentFormattingConfiguration = (await firstValueFrom(document.documentConfiguration$))[this.languageId].format

		const options: VDFFormatStringifyOptions = {
			indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
			insertNewlineBeforeObjects: documentFormattingConfiguration.insertNewlineBeforeObjects,
			quotes: documentFormattingConfiguration.quotes,
			tabSize: params.options.tabSize,
			tabs: documentFormattingConfiguration.tabs,
			newLine: VDFNewLine.LF,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		const MAX_VALUE = ((2 ** 31) - 1)

		return [
			{
				range: Range.create(0, 0, MAX_VALUE, MAX_VALUE),
				newText: formatVDF(document.getText(), document.configuration.VDFParserOptions, options),
			}
		]
	}

	protected async rename(document: TDocument, type: symbol, key: string, newName: string): Promise<Record<string, TextEdit[]>> {

		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		const changes: Record<string, TextEdit[]> = {}

		for (const definition of definitionReferences.definitions.get(type, key) ?? []) {
			const edits = changes[definition.uri.toString()] ??= []
			edits.push(TextEdit.replace(definition.keyRange, newName))
			if (definition.nameRange) {
				edits.push(TextEdit.replace(definition.nameRange, newName))
			}
		}

		const toReference = (await firstValueFrom(document.configuration.dependencies$)).schema.definitionReferences.find((i) => i.type == type)?.toReference

		const referenceText = toReference
			? toReference(newName)
			: newName

		for (const { uri, range } of definitionReferences.references.collect(type, key)) {
			(changes[uri.toString()] ??= []).push(TextEdit.replace(range, referenceText))
		}

		return changes
	}
}
