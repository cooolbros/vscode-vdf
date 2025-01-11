import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { generateTokens } from "common/generateTokens"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import type { VSCodeVDFLanguageID, VSCodeVDFLanguageNameSchema } from "common/VSCodeVDFLanguageID"
import { posix } from "path"
import { firstValueFrom, type Observable } from "rxjs"
import { VDFIndentation, VDFNewLine, VDFPosition } from "vdf"
import { VDFDocumentSymbols } from "vdf-documentsymbols"
import { formatVDF, type VDFFormatStringifyOptions } from "vdf-format"
import { Color, CompletionItem, CompletionItemKind, Range, TextEdit, type ColorPresentationParams, type Connection, type DocumentColorParams, type DocumentFormattingParams, type ServerCapabilities, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { z } from "zod"
import { LanguageServer, type CompletionFiles, type TextDocumentRequestParams } from "../LanguageServer"
import type { TextDocumentInit } from "../TextDocumentBase"
import type { VDFTextDocument, VDFTextDocumentDependencies } from "./VDFTextDocument"

export interface VDFLanguageServerConfiguration<TDocument extends VDFTextDocument<TDocument, TDependencies>, TDependencies> {
	name: "popfile" | "vdf" | "vmt"
	servers: Set<VSCodeVDFLanguageID>
	capabilities: ServerCapabilities
	createDocument(init: TextDocumentInit, documentConfiguration$: Observable<VSCodeVDFConfiguration>, refCountDispose: (dispose: () => void) => void): Promise<TDocument>
}

export abstract class VDFLanguageServer<
	TLanguageId extends Extract<VSCodeVDFLanguageID, "popfile" | "vdf" | "vmt">,
	TDocument extends VDFTextDocument<TDocument, TDependencies>,
	TDependencies
> extends LanguageServer<TLanguageId, TDocument, VDFDocumentSymbols, VDFTextDocumentDependencies> {

	protected readonly VDFLanguageServerConfiguration: VDFLanguageServerConfiguration<TDocument, TDependencies>

	private readonly documentsColours: Map<string, Map<string, (colour: Color) => string>>

	constructor(languageId: TLanguageId, name: z.infer<typeof VSCodeVDFLanguageNameSchema>[TLanguageId], connection: Connection, VDFLanguageServerConfiguration: VDFLanguageServerConfiguration<TDocument, TDependencies>) {
		super(languageId, name, connection, {
			servers: VDFLanguageServerConfiguration.servers,
			capabilities: {
				...VDFLanguageServerConfiguration.capabilities,
				colorProvider: true,
			},
			createDocument: async (init, documentConfiguration$, refCountDispose) => await VDFLanguageServerConfiguration.createDocument(init, documentConfiguration$, refCountDispose)
		})

		this.VDFLanguageServerConfiguration = VDFLanguageServerConfiguration
		this.documentsColours = new Map()

		this.onTextDocumentRequest(this.connection.onDocumentColor, this.onDocumentColor)
		this.onTextDocumentRequest(this.connection.onColorPresentation, this.onColorPresentation)
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
			})
		)
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
				const type = ((): string | null => {

					const documentSymbolKey = schema.completion.typeKey
						? documentSymbol.children?.find((d) => d.key.toLowerCase() == schema.completion.typeKey)?.detail?.toLowerCase()
						: documentSymbol.key.toLowerCase()

					if (documentSymbolKey && documentSymbolKey in schema.keys) {
						return documentSymbolKey
					}

					return schema.completion.defaultType
				})()

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
				return await files(document.configuration.relativeFolderPath ?? "", {
					value: text ?? null,
					extensionsPattern: null,
				})
			}

			key = document.configuration.keyTransform(key.toLowerCase())

			const schema = (await firstValueFrom(document.configuration.dependencies$)).schema

			// Static
			if (key in schema.values) {
				const valueData = schema.values[key]
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
						: undefined
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
			return [
				"[$LINUX]",
				"[$OSX]",
				"[$POSIX]",
				"[$WIN32]",
				"[$WINDOWS]",
				"[$X360]",
			]
				.filter((conditional) => text ? conditional.toLowerCase().startsWith(text.toLowerCase()) : true)
				.map((conditional) => {
					return {
						label: conditional,
						kind: CompletionItemKind.Variable,
					}
				})
		}

		const line = document.getText({ start: { line: position.line, character: 0 }, end: position })
		const tokens = Array.from(generateTokens(line))

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

		for (const [uri, references] of definitionReferences.references) {
			const edits = changes[uri] ??= []
			for (const range of references.get(type, key)) {
				edits.push(TextEdit.replace(range, referenceText))
			}
		}

		return changes
	}
}
