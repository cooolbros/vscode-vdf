import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { posix } from "path"
import { findBestMatch } from "string-similarity"
import { encodeBaseValue } from "utils/encodeBaseValue"
import { normalizeUri } from "utils/normalizeUri"
import { documentLinkDataSchema, type DocumentLinkData } from "utils/types/DocumentLinkData"
import type { LanguageNames } from "utils/types/LanguageNames"
import { VDFIndentation, VDFNewLine, VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbols, getVDFDocumentSymbols, type VDFDocumentSymbol } from "vdf-documentsymbols"
import { formatVDF, type VDFFormatStringifyOptions } from "vdf-format"
import { CodeAction, CodeActionKind, CodeLens, ColorInformation, ColorPresentation, Command, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentLink, Location, Position, Range, TextEdit, WorkspaceEdit, type CodeActionParams, type CodeLensParams, type ColorPresentationParams, type CompletionParams, type Connection, type Definition, type DefinitionParams, type DocumentColorParams, type DocumentFormattingParams, type DocumentLinkParams, type PrepareRenameParams, type ReferenceParams, type RenameParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { z } from "zod"
import { DefinitionReference, DocumentDefinitionReferences, documentSymbolMatchesDefinition, documentSymbolMatchesReferences, type DocumentsDefinitionReferences } from "../DefinitionReferences"
import { LanguageServer } from "../LanguageServer"
import type { VDFLanguageServerConfiguration } from "./VDFLanguageServerConfiguration"

export abstract class VDFLanguageServer<TLanguageId extends Extract<keyof LanguageNames, "popfile" | "vmt" | "vdf">> extends LanguageServer<TLanguageId, VDFDocumentSymbols> {

	protected readonly VDFLanguageServerConfiguration: VDFLanguageServerConfiguration
	private readonly documentsBaseFiles: Map<string, Set<string>>
	private readonly documentsDefinitionReferences: DocumentsDefinitionReferences
	private readonly documentsColours: Map<string, Map<string, number>>

	private oldName: [number, string, VDFRange | undefined] | null

	constructor(languageId: TLanguageId, name: LanguageNames[TLanguageId], connection: Connection, configuration: VDFLanguageServerConfiguration) {
		super(languageId, name, connection, {
			servers: configuration.servers,
			parseDocumentSymbols: (uri, str) => getVDFDocumentSymbols(str, this.VDFLanguageServerConfiguration.getVDFTokeniserOptions(uri)),
			defaultDocumentSymbols: () => new VDFDocumentSymbols()
		}, {
			completionProvider: {
				triggerCharacters: [
					"\"",
					"/"
				]
			},
			definitionProvider: true,
			referencesProvider: true,
			codeActionProvider: true,
			codeLensProvider: {
				resolveProvider: false,
			},
			documentLinkProvider: {
				resolveProvider: true,
			},
			colorProvider: true,
			documentFormattingProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		})

		this.VDFLanguageServerConfiguration = configuration
		this.documentsBaseFiles = new Map<string, Set<string>>()
		this.documentsDefinitionReferences = new Map()
		this.documentsColours = new Map<string, Map<string, number>>()

		this.oldName = null

		this.onTextDocumentRequest(
			this.connection.onCompletion,
			async (params) => !this.documentsConfiguration.get(params.textDocument.uri)[this.languageId].suggest.enable ? null : this.onCompletion(params)
		)
		this.onTextDocumentRequest(this.connection.onDefinition, this.onDefinition)
		this.onTextDocumentRequest(this.connection.onReferences, this.onReferences)
		this.onTextDocumentRequest(this.connection.onCodeAction, this.onCodeAction)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(this.connection.onDocumentLinks, this.onDocumentLinks)

		this.connection.onDocumentLinkResolve(this.onDocumentLinkResolve.bind(this))

		this.onTextDocumentRequest(this.connection.onDocumentColor, this.onDocumentColor)
		this.onTextDocumentRequest(this.connection.onColorPresentation, this.onColorPresentation)
		this.onTextDocumentRequest(this.connection.onDocumentFormatting, this.onDocumentFormatting)
		this.onTextDocumentRequest(this.connection.onPrepareRename, this.onPrepareRename)
		this.onTextDocumentRequest(this.connection.onRenameRequest, this.onRenameRequest)
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				files: t.router({
					documentSymbolKeys: t
						.procedure
						.input(
							z.object({
								uri: z.string()
							})
						).query(async ({ input }) => {
							const { uri } = input

							const documentSymbols = this.documentsSymbols.get(uri)
								?? this.languageServerConfiguration.parseDocumentSymbols(uri, await this.trpc.client.fileSystem.readFile.query({ uri }))

							const keys: string[] = []

							documentSymbols.forAll((documentSymbol) => {
								if (documentSymbol.children) {
									keys.push(documentSymbol.key)
								}
							})

							return keys
						}),
					documentSymbolLocation: t
						.procedure
						.input(
							z.object({
								uris: z.string().array(),
								key: z.string()
							})
						)
						.query(async ({ input }) => {

							const { uris, key } = input

							for (const uri of uris) {

								try {
									const documentSymbols = this.documentsSymbols.get(uri)
										?? this.languageServerConfiguration.parseDocumentSymbols(uri, await this.trpc.client.fileSystem.readFile.query({ uri }))

									const documentSymbol = documentSymbols.findRecursive((documentSymbol) => documentSymbol.key.toLowerCase() == key)
									if (!documentSymbol) {
										return null
									}

									return {
										uri: uri,
										range: documentSymbol.nameRange
									}
								}
								catch (error: any) {
									this.connection.console.log(error.stack)
									continue
								}
							}

							return null
						}),
					setReferences: t
						.procedure
						.input(
							z.object({
								uri: z.string(),
								references: z.record(
									z.object({
										type: z.number(),
										key: z.string(),
										range: VDFRange.schema
									}).array()
								)
							})
						)
						.query(async ({ input }) => {
							const referenceParams = input

							let documentDefinitionReferences = this.documentsDefinitionReferences.get(referenceParams.uri)
							if (!documentDefinitionReferences) {
								documentDefinitionReferences = new DocumentDefinitionReferences(this.VDFLanguageServerConfiguration.definitionReferences.length)
								this.documentsDefinitionReferences.set(referenceParams.uri, documentDefinitionReferences)
							}

							for (const uri in referenceParams.references) {

								documentDefinitionReferences.deleteReferences(uri)

								const references = referenceParams.references[uri]

								for (const reference of references) {
									const range = new VDFRange(
										new VDFPosition(reference.range.start.line, reference.range.start.character),
										new VDFPosition(reference.range.end.line, reference.range.end.character)
									)
									documentDefinitionReferences.get([reference.type, reference.key]).addReference(uri, range)
								}
							}

							this.codeLensRefresh()
						})
				})
			})
		)
	}

	protected onDidClose(e: TextDocumentChangeEvent<TextDocument>): void {
		super.onDidClose(e)
		this.documentsBaseFiles.delete(e.document.uri)
		for (const baseFiles of this.documentsBaseFiles.values()) {
			baseFiles.delete(e.document.uri)
		}
		this.documentsDefinitionReferences.delete(e.document.uri)
		this.documentsColours.delete(e.document.uri)
	}

	protected async validateTextDocument(uri: string, documentSymbols: VDFDocumentSymbols): Promise<Diagnostic[]> {

		const definitionReferences = await this.onDefinitionReferences(uri)
		const diagnostics: Diagnostic[] = []

		documentSymbols.forAll(async (documentSymbol, objectPath) => {

			if (documentSymbol.detail == undefined || documentSymbol.detailRange == undefined) {
				return
			}

			const documentSymbolKey = this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase())

			if (documentSymbolKey == "#base" && documentSymbol.detail != "") {

				const folder = posix.dirname(uri)
				const detail = encodeBaseValue(documentSymbol.detail.toLowerCase())
				const baseUri = `${folder}/${detail}`
				const newPath = posix.relative(folder, baseUri)

				if (baseUri == uri) {
					diagnostics.push({
						range: documentSymbol.detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "base-self-reference",
						message: "#base file references itself.",
					})

					return
				}

				if (detail != newPath) {
					diagnostics.push({
						range: documentSymbol.detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "useless-path",
						message: "Unnecessary relative file path.",
						data: {
							documentSymbol: documentSymbol,
							newText: newPath
						}
					})
				}

				return
			}

			if (documentSymbolKey in this.VDFLanguageServerConfiguration.schema.values) {

				const documentSymbolValue = documentSymbol.detail.toLowerCase()

				const valueData = this.VDFLanguageServerConfiguration.schema.values[documentSymbolKey]

				for (const [index, value] of valueData.values.entries()) {
					if (documentSymbolValue == value.toLowerCase() || (valueData.enumIndex && documentSymbolValue == index.toString())) {
						return
					}
				}

				diagnostics.push({
					range: documentSymbol.detailRange,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-value",
					message: `'${documentSymbol.detail}' is not a valid value for ${documentSymbol.key}. Expected '${valueData.values.join("' | '")}'`,
					data: {
						documentSymbol: documentSymbol,
						newText: valueData.fix?.[documentSymbolValue],
					}
				})
			}

			const type = ((): number | null => {
				const definitionReferenceIndex = this.VDFLanguageServerConfiguration.definitionReferences
					.findIndex((definitionReferenceConfiguration) => {
						return definitionReferenceConfiguration.referenceKeys.has(documentSymbolKey)
					})

				if (definitionReferenceIndex > -1) {
					return definitionReferenceIndex
				}
				if (this.VDFLanguageServerConfiguration.rename?.keys.has(documentSymbolKey)) {
					return this.VDFLanguageServerConfiguration.rename.type
				}
				return null
			})()

			if (type != null && documentSymbol.detail != "") {
				const definitionLocation = definitionReferences.get([type, documentSymbol.detail]).getDefinitionLocation()

				if (!definitionLocation) {
					diagnostics.push({
						range: documentSymbol.detailRange,
						severity: DiagnosticSeverity.Warning,
						code: "invalid-reference",
						message: `Cannot find ${this.VDFLanguageServerConfiguration.definitionReferences[type].name} '${documentSymbol.detail}'.`,
						data: {
							documentSymbol: documentSymbol,
							type: type
						}
					})
				}
			}

			const diagnostic = await this.validateDocumentSymbol(uri, documentSymbol, objectPath)

			if (diagnostic) {
				diagnostics.push(diagnostic)
			}
		})

		return diagnostics
	}

	protected abstract validateDocumentSymbol(uri: string, documentSymbol: VDFDocumentSymbol, objectPath: string[]): Promise<Diagnostic | null>

	private async onDefinitionReferences(uri: string): Promise<DocumentDefinitionReferences> {

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(uri)
			?? new DocumentDefinitionReferences(this.VDFLanguageServerConfiguration.definitionReferences.length)

		const documentSymbols = this.documentsSymbols.get(uri)
		if (!documentSymbols) {
			return documentDefinitionReferences
		}

		const folderUri = posix.dirname(uri)
		const baseFileUris: string[] = []

		// Recursively remove old references
		documentDefinitionReferences.deleteDefinitions()
		documentDefinitionReferences.deleteReferences(uri)

		const deleteReferences = (dependentFileUri: string): void => {
			const dependentFiles = this.documentsBaseFiles.get(dependentFileUri)
			if (dependentFiles) {
				for (const dependentFile of dependentFiles) {
					documentDefinitionReferences.deleteReferences(dependentFile)
					deleteReferences(dependentFile)
				}

				// Delete dependent file #base list, the list will be reconstructed when we call `this.onDidChangeContent({ document })`
				this.documentsBaseFiles.delete(dependentFileUri)
			}
		}

		deleteReferences(uri)

		// Test
		for (const [, , definitionReference] of documentDefinitionReferences) {
			for (const r of definitionReference.getReferences()) {
				if (r.uri.endsWith(".res")) {
					throw new Error(`Recursive references removal failed, starting at uri '${uri}'`)
				}
			}
		}

		documentSymbols.forAll(async (documentSymbol, objectPath) => {

			if (objectPath.length == 0 && documentSymbol.detail && this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase()) == "#base") {
				baseFileUris.push(normalizeUri(`${folderUri}/${encodeBaseValue(documentSymbol.detail)}`))
			}

			this.VDFLanguageServerConfiguration.definitionReferences.find((definitionReferenceConfiguration, index) => {

				const definitionKey = documentSymbolMatchesDefinition(definitionReferenceConfiguration, documentSymbol, objectPath)

				if (definitionKey != null) {

					if (definitionReferenceConfiguration.parentKeys.length > 0 && objectPath.at(-1)?.toLowerCase() != definitionReferenceConfiguration.parentKeys.at(-1)) {
						// documentSymbol is inside an object that could be match a definition
						// Don't check documentSymbols inside potential definition
						return false
					}

					const definitionReference = documentDefinitionReferences.get([index, definitionKey])
					if (definitionReference.getDefinitionLocation() == undefined) {

						const definitionIDKeyRange = definitionReferenceConfiguration.definitionIDKey != undefined
							? documentSymbol.children?.find((i) => i.key.toLowerCase() == definitionReferenceConfiguration.definitionIDKey && i.detail != undefined)?.detailRange
							: undefined

						definitionReference.setDefinitionLocation({
							definitionLocation: {
								uri: uri,
								range: documentSymbol.nameRange
							},
							...(definitionIDKeyRange != undefined && {
								definitionIDLocation: {
									uri: uri,
									range: definitionIDKeyRange,
								}
							}),
							value: documentSymbol.detail ?? documentSymbol.children
						})
					}
					return true
				}

				if (!documentSymbol.detail) {
					return false
				}

				if (documentSymbolMatchesReferences(definitionReferenceConfiguration, this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase()))) {
					const definitionReferencesValue = documentDefinitionReferences.get([
						index,
						definitionReferenceConfiguration.transform ? definitionReferenceConfiguration.transform(documentSymbol.detail) : documentSymbol.detail
					])
					definitionReferencesValue.addReference(uri, documentSymbol.detailRange!)
					return true
				}

				return false
			})
		})

		const seenFiles = new Set<string>([uri])

		// Recursively add definitions from #base files
		const addBaseDefinitions = async (baseUri: string): Promise<void> => {

			try {

				// Protect against infinite #base
				if (seenFiles.has(baseUri)) {
					return
				}
				seenFiles.add(baseUri)

				baseUri = await (async (): Promise<string> => {

					const fileBaseUri = baseUri
					if (await this.trpc.client.fileSystem.exists.query({ uri: fileBaseUri })) {
						return fileBaseUri
					}

					if (this.VDFLanguageServerConfiguration.vpkRootPath) {
						const vpkBaseUri = `vpk:///${this.VDFLanguageServerConfiguration.vpkRootPath}/${posix.basename(baseUri)}?vpk=misc`
						if (await this.trpc.client.fileSystem.exists.query({ uri: vpkBaseUri })) {
							return vpkBaseUri
						}
					}

					throw ""
				})()

				const baseDocumentSymbols = this.documentsSymbols.has(baseUri)
					? this.documentsSymbols.get(baseUri)!
					: await (async (): Promise<VDFDocumentSymbols> => {
						const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(baseUri, await this.trpc.client.fileSystem.readFile.query({ uri: baseUri }))
						this.documentsSymbols.set(baseUri, documentSymbols)
						return documentSymbols
					})()

				const baseDefinitionReferences = this.documentsDefinitionReferences.has(baseUri)
					? this.documentsDefinitionReferences.get(baseUri)!
					: await this.onDefinitionReferences(baseUri)

				// Delete previous references
				baseDefinitionReferences.deleteReferences(baseUri)

				for (const [index, , baseDefinitionReference] of baseDefinitionReferences) {

					const definitionReference = documentDefinitionReferences.get([index, baseDefinitionReference.key])
					const baseDefinitionLocation = baseDefinitionReference.getDefinitionLocation()

					if (definitionReference.getDefinitionLocation() == undefined && baseDefinitionLocation != undefined) {

						definitionReference.setDefinitionLocation({
							definitionLocation: baseDefinitionLocation,
							definitionIDLocation: baseDefinitionReference.getDefinitionIDLocation(),
							value: baseDefinitionReference.hasValue() ? baseDefinitionReference.getValue() : undefined
						})

						for (const reference of definitionReference.getReferences()) {
							baseDefinitionReference.addReference(reference.uri, reference.range)
						}
					}
				}

				const baseFolderUri = posix.dirname(baseUri)

				const baseUris = baseDocumentSymbols
					.filter((documentSymbol): documentSymbol is VDFDocumentSymbol & { detail: string } => documentSymbol.key == "#base" && documentSymbol.detail != undefined)
					.map((documentSymbol) => normalizeUri(`${baseFolderUri}/${encodeBaseValue(documentSymbol.detail)}`))

				for (const baseUri of baseUris) {
					await addBaseDefinitions(baseUri)
				}

			}
			catch (error: any) {
				if (error.code == -32603) {
					// Error: Unable to resolve nonexistent file
					return
				}
				this.connection.console.error(`[VDFLanguageServer addBaseDefinitions]: ${baseUri} : ${error.message}`)
			}
		}

		for (const baseFileUri of baseFileUris) {

			await addBaseDefinitions(baseFileUri)

			if (!this.documentsBaseFiles.has(baseFileUri)) {
				this.documentsBaseFiles.set(baseFileUri, new Set<string>())
			}

			// Listen for change events on #base files
			this.documentsBaseFiles.get(baseFileUri)!.add(uri)
		}

		this.documentsDefinitionReferences.set(uri, documentDefinitionReferences)

		// If this is a #base file
		if (this.documentsBaseFiles.has(uri)) {

			// Update files that reference this file
			for (const dependentUri of this.documentsBaseFiles.get(uri)!) {
				const document = this.documents.get(dependentUri)
				if (document) {
					this.onDidChangeContent({ document })
				}
			}
		}

		// If we are no longer referencing a #base file
		for (const [baseFileUri, referenceFiles] of this.documentsBaseFiles) {
			if (referenceFiles.has(uri) && !baseFileUris.includes(baseFileUri)) {

				referenceFiles.delete(uri)

				const document = this.documents.get(baseFileUri)
				if (document) {
					this.onDidChangeContent({ document })
				}
			}
		}

		this.codeLensRefresh()

		return documentDefinitionReferences
	}

	protected async onCompletion(params: CompletionParams): Promise<CompletionItem[] | null> {
		try {
			const document = this.documents.get(params.textDocument.uri)
			if (!document) {
				return null
			}

			const line = document.getText({
				start: Position.create(params.position.line, 0),
				end: Position.create(params.position.line, params.position.character),
			})

			const tokens = line.split(/\s+/).filter((i) => i != "")
			if (tokens.length <= 1) {
				// Suggest key
				const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
				if (!documentSymbols) {
					return null
				}

				const documentSymbol = documentSymbols.getDocumentSymbolAtPosition(params.position)
				if (!documentSymbol) {
					if (this.VDFLanguageServerConfiguration.completion.root) {
						return this.VDFLanguageServerConfiguration.completion.root.filter((item) => !documentSymbols.some((i) => i.key == item.label))
					}
					return null
				}

				const type = ((): string | undefined => {

					const documentSymbolKey = this.VDFLanguageServerConfiguration.completion.typeKey
						? documentSymbol.children?.find((d) => d.key.toLowerCase() == this.VDFLanguageServerConfiguration.completion.typeKey)?.detail?.toLowerCase()
						: documentSymbol.key.toLowerCase()

					if (documentSymbolKey && documentSymbolKey in this.VDFLanguageServerConfiguration.schema.keys) {
						return documentSymbolKey
					}

					return this.VDFLanguageServerConfiguration.completion.defaultType
				})()

				if (!type) {
					return null
				}

				const include = (k: string): CompletionItem[] => {
					const value = this.VDFLanguageServerConfiguration.schema.keys[k]
					// @ts-ignore
					return [
						...(value.reference ? value.reference.flatMap(include) : []),
						...value.values.filter((value) => value.multiple || !documentSymbol.children?.some((d) => d.key.toLowerCase() == value.label.toLowerCase()))
					]
				}

				return include(type)
			}
			else {
				// Suggest value
				let key = line.split(/[\s"]+/).find((i) => i != "")
				if (!key) {
					return null
				}
				key = this.VDFLanguageServerConfiguration.keyHash(key.toLowerCase())

				const value = tokens.pop()?.replaceAll(/["]+/g, "")

				if (key == "#base") {
					return this.getFilesCompletion(params.textDocument, {
						items: (this.VDFLanguageServerConfiguration.completion.files ?? []).map((value) => ({ label: value, kind: CompletionItemKind.File, sortText: "#" })),
						uri: posix.dirname(params.textDocument.uri),
						relativePath: value,
						extensionsFilter: this.VDFLanguageServerConfiguration.completion.extensions,
						displayExtensions: true
					})
				}

				if (key in this.VDFLanguageServerConfiguration.schema.values) {
					const valueData = this.VDFLanguageServerConfiguration.schema.values[key]
					return valueData.values.map((value, index) => ({
						label: value,
						kind: <CompletionItemKind>valueData.kind,
						...(valueData.enumIndex && {
							detail: `${index}`
						})
					}))
				}

				for (const [type, definitionReferencesConfiguration] of this.VDFLanguageServerConfiguration.definitionReferences.entries()) {
					if (definitionReferencesConfiguration.referenceKeys.has(key)) {
						return [...this.documentsDefinitionReferences.get(params.textDocument.uri)!.ofType(type).values()]
							.filter((definitionReference) => definitionReference.getDefinitionLocation() != undefined)
							.map((definitionReference) => ({
								label: definitionReference.key,
								kind: CompletionItemKind.Variable
							}))
					}
				}

				return this.getCompletionValues(params.textDocument.uri, key, value)
			}

		}
		catch (error: any) {
			this.connection.console.log(error.stack!)
			return null
		}
	}

	protected abstract getCompletionValues(uri: string, key: string, value?: string): Promise<CompletionItem[] | null>

	protected onDefinition(params: DefinitionParams): Definition | null {

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		const referenceDocumentSymbol = documentSymbols.getDocumentSymbolAtPosition(params.position)
		if (!referenceDocumentSymbol || !referenceDocumentSymbol.detailRange?.contains(params.position)) {
			return null
		}

		const key = this.VDFLanguageServerConfiguration.keyHash(referenceDocumentSymbol.key.toLowerCase())

		const definitionsReferencesIndex = this.VDFLanguageServerConfiguration.definitionReferences.findIndex((value) => value.referenceKeys.has(key))
		if (definitionsReferencesIndex == -1) {
			return null
		}

		const definitionLocation = this.documentsDefinitionReferences.get(params.textDocument.uri)?.get([definitionsReferencesIndex, referenceDocumentSymbol.detail!])?.getDefinitionLocation()

		if (!definitionLocation) {
			return null
		}

		return definitionLocation
	}

	protected onReferences(params: ReferenceParams): Location[] | null {

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (!documentDefinitionReferences) {
			return null
		}

		let definitionReferenceInfo: [number, string, DefinitionReference] | null = null
		for (const [index, key, definitionReference] of documentDefinitionReferences) {
			if (definitionReference.getDefinitionLocation()?.uri == params.textDocument.uri && definitionReference.getDefinitionLocation()?.range.contains(params.position)) {
				definitionReferenceInfo = [index, key, definitionReference]
				break
			}
		}

		if (definitionReferenceInfo == null) {
			return null
		}

		const [, , definitionReference] = definitionReferenceInfo

		return [...definitionReference.getReferences()]
	}

	protected onCodeAction(params: CodeActionParams): (Command | CodeAction)[] {

		const diagnosticDataSchema = z.object({
			documentSymbol: z.any().transform((arg) => <VDFDocumentSymbol>arg),
			newText: z.string().optional(),
			type: z.number().optional(),
		})

		const uri = params.textDocument.uri

		const codeActions: (Command | CodeAction)[] = []

		for (const diagnostic of params.context.diagnostics) {

			const result = diagnosticDataSchema.safeParse(diagnostic.data)
			if (!result.success) {
				// No possible code actions
				this.connection.console.log(`No possible code actions for ${JSON.stringify(diagnostic)}`)
				continue
			}

			const { documentSymbol, newText, type } = result.data

			switch (diagnostic.code) {
				case "invalid-value": {
					if (newText == undefined) {
						break
					}
					codeActions.push({
						title: `Change ${documentSymbol.key} to '${newText}'`,
						kind: CodeActionKind.QuickFix,
						diagnostics: [diagnostic],
						isPreferred: true,
						edit: {
							changes: {
								[uri]: [
									{
										range: documentSymbol.detailRange!,
										newText: newText,
									}
								]
							}
						}
					})
					break
				}
				case "invalid-reference": {
					if (type == undefined) {
						break
					}

					const definitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
					if (!definitionReferences) {
						break
					}

					const definitionKeys: string[] = []
					for (const definitionReference of definitionReferences.ofType(type).values()) {
						if (definitionReference.getDefinitionLocation() != undefined) {
							definitionKeys.push(definitionReference.key)
						}
					}

					if (!definitionKeys.length) {
						break
					}

					const match = findBestMatch(
						documentSymbol.detail!,
						definitionKeys
					)

					const suggestedValue = definitionReferences.get([type, match.bestMatch.target]).key

					codeActions.push({
						title: `Change ${documentSymbol.key} to '${suggestedValue}'`,
						kind: CodeActionKind.QuickFix,
						diagnostics: [diagnostic],
						isPreferred: true,
						edit: {
							changes: {
								[uri]: [
									{
										range: documentSymbol.detailRange!,
										newText: suggestedValue,
									}
								]
							}
						},
					})

					break
				}
				case "useless-path": {
					if (newText == undefined) {
						break
					}
					codeActions.push({
						title: "Normalize file path",
						kind: CodeActionKind.QuickFix,
						diagnostics: [diagnostic],
						isPreferred: true,
						edit: {
							changes: {
								[uri]: [
									{
										range: documentSymbol.detailRange!,
										newText: newText,
									}
								]
							}
						}
					})
					break
				}
			}
		}

		return codeActions
	}

	protected onCodeLens(params: CodeLensParams): CodeLens[] | null {

		const definitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (!definitionReferences) {
			return null
		}

		const codeLens: CodeLens[] = []

		for (const [, , definitionReference] of definitionReferences) {

			const definitionLocation = definitionReference.getDefinitionLocation()

			const references = [...definitionReference.getReferences()]

			if (references.length && definitionLocation?.uri == params.textDocument.uri) {
				codeLens.push({
					range: definitionLocation.range,
					command: {
						title: `${references.length} reference${references.length == 1 ? "" : "s"}`,
						command: "vscode-vdf.showReferences",
						arguments: [
							params.textDocument.uri,
							definitionLocation.range,
							references
						]
					}
				})
			}
		}

		return codeLens
	}

	private async onDocumentLinks(params: DocumentLinkParams): Promise<DocumentLink[] | null> {

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		const links: Promise<DocumentLinkData | null>[] = []

		documentSymbols.forAll((documentSymbol) => {
			if (documentSymbol.children) {
				return
			}

			const key = this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase())

			if (key == "#base" && documentSymbol.detailRange) {
				links.push(Promise.resolve({
					range: documentSymbol.detailRange,
					data: {
						uri: params.textDocument.uri,
						key: documentSymbol.key,
						value: documentSymbol.detail!
					}
				}))
			}
			else if (documentSymbol.detail! != "") {
				for (const [index, link] of this.VDFLanguageServerConfiguration.links.entries()) {
					if (link.keys.has(key)) {
						links.push((async (): Promise<DocumentLinkData | null> => {
							if (link.check ? await link.check(params.textDocument.uri, documentSymbol) : true) {
								return {
									range: documentSymbol.detailRange!,
									data: {
										uri: params.textDocument.uri,
										key: documentSymbol.key,
										value: documentSymbol.detail!,
										index: index
									}
								}
							}
							return null
						})())
						break
					}
				}
			}
		})

		return (await Promise.all(links)).filter((i): i is DocumentLinkData => i != null)
	}

	private async onDocumentLinkResolve(documentLink: DocumentLink): Promise<DocumentLink | null> {

		const link = documentLinkDataSchema.parse(documentLink)

		if (link.data.key == "#base") {

			const fileName = encodeBaseValue(link.data.value.toLowerCase())

			const fileUri = `${posix.dirname(link.data.uri)}/${fileName}`

			if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
				documentLink.target = fileUri
				return documentLink
			}

			if (this.VDFLanguageServerConfiguration.vpkRootPath) {
				const vpkBaseUri = `vpk:///${this.VDFLanguageServerConfiguration.vpkRootPath}/${fileName}?vpk=misc`
				if (await this.trpc.client.fileSystem.exists.query({ uri: vpkBaseUri })) {
					documentLink.target = vpkBaseUri
					return documentLink
				}
			}

			// Prompt user to create file
			documentLink.target = fileUri
			return documentLink
		}

		if (link.data.index != undefined && link.data.index > -1) {
			return this.VDFLanguageServerConfiguration.links[link.data.index].resolve(link)
		}

		return null
	}

	private onDocumentColor(params: DocumentColorParams): ColorInformation[] | null {

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)

		if (!documentSymbols) {
			return null
		}

		const colours: ColorInformation[] = []

		const documentColours = new Map<string, number>()
		this.documentsColours.set(params.textDocument.uri, documentColours)

		documentSymbols.forAll((documentSymbol) => {

			if (documentSymbol.children) {
				return
			}

			const key = this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase())

			this.VDFLanguageServerConfiguration.colours.find((value, index) => {
				if (value.keys ? value.keys.has(key) : true) {
					const result = value.parse(documentSymbol.detail!)
					if (result == null) {
						return false
					}
					const r = documentSymbol.detailRange!
					documentColours.set(`${r.start.line}.${r.start.character}.${r.end.line}.${r.end.line}`, index)
					colours.push({
						range: r,
						color: result
					})
					return true
				}
				return false
			})
		})

		return colours
	}

	private onColorPresentation(params: ColorPresentationParams): ColorPresentation[] | null {

		const r = params.range

		const index = this.documentsColours
			?.get(params.textDocument.uri)
			?.get(`${r.start.line}.${r.start.character}.${r.end.line}.${r.end.line}`)

		if (index == undefined) {
			return null
		}

		return [
			{
				label: this.VDFLanguageServerConfiguration.colours[index].stringify(params.color)
			}
		]
	}

	private onDocumentFormatting(params: DocumentFormattingParams): TextEdit[] | null {

		const document = this.documents.get(params.textDocument.uri)

		if (!document) {
			return null
		}

		try {

			const documentFormattingConfiguration = this.documentsConfiguration.get(params.textDocument.uri)[this.languageId].format

			const options: VDFFormatStringifyOptions = {
				indentation: params.options.insertSpaces ? VDFIndentation.Spaces : VDFIndentation.Tabs,
				insertNewlineBeforeObjects: documentFormattingConfiguration.insertNewlineBeforeObjects,
				quotes: documentFormattingConfiguration.quotes,
				tabSize: params.options.tabSize,
				tabs: documentFormattingConfiguration.tabs,
				newLine: VDFNewLine.LF,
				insertFinalNewline: params.options.insertFinalNewline ?? false,
			}

			this.connection.console.log(JSON.stringify(params.options))

			const MAX_VALUE = ((2 ** 31) - 1)

			return [
				{
					range: Range.create(0, 0, MAX_VALUE, MAX_VALUE),
					newText: formatVDF(document.getText(), this.VDFLanguageServerConfiguration.getVDFTokeniserOptions(params.textDocument.uri), options),
				}
			]
		}
		catch (error: any) {
			this.connection.console.log(error.stack!)
			return null
		}
	}

	protected onPrepareRename(params: PrepareRenameParams): Range | null {

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (!documentDefinitionReferences) {
			return null
		}

		for (const [type, key, definitionReference] of documentDefinitionReferences) {
			const definitionLocation = definitionReference.getDefinitionLocation()
			if (definitionLocation?.uri == params.textDocument.uri && definitionLocation.range.contains(params.position)) {
				this.oldName = [type, key, undefined]
				return definitionLocation.range
			}

			const definitionIDKeyLocation = definitionReference.getDefinitionIDLocation()
			if (definitionIDKeyLocation?.uri == params.textDocument.uri && definitionIDKeyLocation.range.contains(params.position)) {
				this.oldName = [type, key, undefined]
				return definitionIDKeyLocation.range
			}
		}

		const documentSymbol = this.documentsSymbols.get(params.textDocument.uri)?.getDocumentSymbolAtPosition(params.position)
		if (!documentSymbol) {
			return null
		}

		if (!documentSymbol.detailRange?.contains(params.position)) {
			return null
		}

		const key = this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase())

		for (const [index, definitionReferences] of this.VDFLanguageServerConfiguration.definitionReferences.entries()) {
			if (definitionReferences.referenceKeys.has(key)) {
				this.oldName = [index, documentSymbol.detail!.toLowerCase(), undefined]
				return documentSymbol.detailRange!
			}
		}

		// Permit renaming by arbitrary keys
		if (this.VDFLanguageServerConfiguration.rename?.keys.has(key)) {
			this.oldName = [this.VDFLanguageServerConfiguration.rename.type, documentSymbol.detail!.toLowerCase(), documentSymbol.detailRange!]
			return documentSymbol.detailRange!
		}

		return null
	}

	protected onRenameRequest(params: RenameParams): WorkspaceEdit {

		if (!this.oldName) {
			throw new Error("oldName is undefined")
		}

		const changes: { [uri: string]: TextEdit[] } = {}

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (documentDefinitionReferences) {

			for (const [index, key, definitionReference] of documentDefinitionReferences) {

				if (index == this.oldName[0] && key == this.oldName[1]) {

					const definitionLocation = definitionReference.getDefinitionLocation()
					if (definitionLocation) {
						changes[definitionLocation.uri] ??= []
						if (!this.VDFLanguageServerConfiguration.definitionReferences[index].definitionIDKey) {
							changes[definitionLocation.uri].push(TextEdit.replace(definitionLocation.range, params.newName))
						}
						else {
							// Add TextEdit for definition ID key
							const definitionIDKeyLocation = definitionReference.getDefinitionIDLocation()
							if (definitionIDKeyLocation) {
								changes[definitionLocation.uri].push(TextEdit.replace(definitionIDKeyLocation.range, params.newName))
							}
						}
					}

					for (const reference of definitionReference.getReferences()) {
						changes[reference.uri] ??= []
						changes[reference.uri].push(TextEdit.replace(reference.range, params.newName))
					}
				}
			}
		}

		if (this.oldName[2]) {
			changes[params.textDocument.uri].push(TextEdit.replace(this.oldName[2], params.newName))
		}

		this.oldName = null
		this.codeLensRefresh()

		return { changes }
	}
}
