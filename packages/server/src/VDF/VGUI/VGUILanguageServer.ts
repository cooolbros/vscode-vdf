import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { posix } from "path"
import { encodeBaseValue } from "utils/encodeBaseValue"
import { normalizeUri } from "utils/normalizeUri"
import type { DocumentLinkData } from "utils/types/DocumentLinkData"
import { VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeLens, Color, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentLink, Location, Range, type CodeLensParams, type CompletionParams, type Connection, type Definition, type DefinitionParams, type PrepareRenameParams, type ReferenceParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { z } from "zod"
import { DocumentDefinitionReferences, documentSymbolMatchesDefinition, documentSymbolMatchesReferences } from "../../DefinitionReferences"
import { VDFLanguageServer } from "../VDFLanguageServer"
import type { VDFDefinitionReferencesConfiguration } from "../VDFLanguageServerConfiguration"
import { VGUIDefinitionReferences, type DefinitionFile } from "./VGUIDefinitionReferences"
import clientscheme from "./clientscheme.json"
import keys from "./keys.json"
import values from "./values.json"

export const enum VGUIDefinitionType {
	Colors,
	Borders,
	Fonts,
	Language
}

export interface VGUIDefinitionReferencesConfiguration extends VDFDefinitionReferencesConfiguration {
	readonly type: VGUIDefinitionType
	readonly files: string[]
}

export class VGUILanguageServer extends VDFLanguageServer {

	private static readonly HUDDefinitionReferences: VGUIDefinitionReferencesConfiguration[] = [
		...Object.entries(clientscheme).map(([key, values], index) => ({
			name: key.substring(0, key.length - 1).toLowerCase(),
			type: index,
			files: ["resource/clientscheme.res"],
			parentKeys: ["Scheme".toLowerCase(), key.toLowerCase()],
			referenceKeys: new Set<string>(values)
		})),
		{
			name: "string",
			type: VGUIDefinitionType.Language,
			files: ["resource/chat_english.txt", "resource/tf_english.txt"],
			parentKeys: ["lang", "Tokens".toLowerCase()],
			referenceKeys: new Set<string>([
				"labelText".toLowerCase(),
				"title"
			]),
			transform(value: string): string {
				return value.substring(1)	// Remove '#'
			},
		}
	]

	protected readonly languageId: Extract<VDFLanguageServer["languageId"], "vdf">
	protected readonly name: Extract<VDFLanguageServer["name"], "VDF">
	private readonly documentHUDRoots: Map<string, string | null>
	private readonly HUDSchemes: Map<string, VGUIDefinitionReferences>

	constructor(languageId: VGUILanguageServer["languageId"], name: VGUILanguageServer["name"], connection: Connection) {
		super(languageId, name, connection, {
			getVDFTokeniserOptions: (uri) => {
				return {
					allowMultilineStrings: /(tf|chat)_.*?\.txt/.test(posix.basename(uri))
				}
			},
			servers: new Set(["hudanimations"]),
			keyHash: (key) => {
				return key.replace("_minmode", "")
			},
			schema: {
				keys: keys,
				values: values
			},
			completion: {
				typeKey: "ControlName".toLowerCase(),
				defaultType: "Panel".toLowerCase()
			},
			definitionReferences: [
				{
					name: "element",
					parentKeys: [],
					definitionChildren: true,
					referenceKeys: new Set([
						"pin_to_sibling",
						"navUp".toLowerCase(),
						"navDown".toLowerCase(),
						"navLeft".toLowerCase(),
						"navRight".toLowerCase(),
						"navToRelay".toLowerCase(),
					])
				}
			],
			links: [
				{
					keys: new Set([
						"image",
						...Array.from({ length: 3 }).map((_, index) => `teambg_${index + 1}`)
					]),
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink> => {
						const hudRoot = this.documentHUDRoots.get(documentLink.data.uri)
						if (hudRoot) {
							const vmtPath = `${hudRoot}/${posix.normalize(`materials/vgui/${documentLink.data.value}.vmt`)}`
							if (await this.trpc.client.fileSystem.exists.query({ uri: vmtPath })) {
								documentLink.target = vmtPath
								return documentLink
							}
						}
						documentLink.target = `vpk:///${posix.normalize(`materials/vgui/${documentLink.data.value.toLowerCase()}.vmt`)}?vpk=misc`
						return documentLink
					}
				},
				{
					keys: new Set([
						"font",
					]),
					check: async (uri: string, documentSymbol: VDFDocumentSymbol): Promise<boolean> => {
						let hudRoot = this.documentHUDRoots.get(uri)
						if (hudRoot === undefined) {
							hudRoot = (await this.trpc.client.searchForHUDRoot.query({ uri }))?.toString() ?? null
						}

						const fileUri = `${hudRoot}/${encodeBaseValue(documentSymbol.detail!)}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
							return true
						}

						const configuration = this.documentsConfiguration.get(uri)
						if (!configuration) {
							// Document closed
							return false
						}

						const tfUri = `${configuration.teamFortress2Folder}/tf/${encodeBaseValue(documentSymbol.detail!)}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: tfUri })) {
							return true
						}

						// No VPK Uri as VPKs cannot contain font files.

						return false
					},
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink | null> => {

						const hudRoot = this.documentHUDRoots.get(documentLink.data.uri)

						const fileUri = `${hudRoot}/${encodeBaseValue(documentLink.data.value)}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
							documentLink.target = fileUri
							return documentLink
						}

						const tfUri = `${this.documentsConfiguration.get(documentLink.data.uri).teamFortress2Folder}/tf/${encodeBaseValue(documentLink.data.value)}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: tfUri })) {
							documentLink.target = tfUri
							return documentLink
						}

						return documentLink
					}
				},
				{
					keys: new Set([
						"file"
					]),
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink | null> => {
						const hudRoot = this.documentHUDRoots.get(documentLink.data.uri)
						if (hudRoot !== undefined) {
							const hudFilePath = `${hudRoot}/${encodeBaseValue(documentLink.data.value)}`
							if (await this.trpc.client.fileSystem.exists.query({ uri: hudFilePath })) {
								documentLink.target = hudFilePath
								return documentLink
							}
						}

						const vpkFilePath = `vpk:///${posix.normalize(`${encodeBaseValue(documentLink.data.value.toLowerCase())}`)}?vpk=misc`
						if (await this.trpc.client.fileSystem.exists.query({ uri: vpkFilePath })) {
							documentLink.target = vpkFilePath
						}

						return documentLink
					}
				}
			],
			colours: [
				{
					parse: (value: string): Color | null => {
						if (/\d+\s+\d+\s+\d+\s+\d+/.test(value)) {
							const colour = value.split(/\s+/)
							return {
								red: parseInt(colour[0]) / 255,
								green: parseInt(colour[1]) / 255,
								blue: parseInt(colour[2]) / 255,
								alpha: parseInt(colour[3]) / 255
							}
						}
						return null
					},
					stringify: (colour: Color): string => {
						return `${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} ${Math.round(colour.alpha * 255)}`
					}
				}
			],
			rename: {
				type: 0,
				keys: new Set(["fieldName".toLowerCase()])
			}
		})

		this.name = name
		this.languageId = languageId
		this.documentHUDRoots = new Map<string, string | null>()
		this.HUDSchemes = new Map<string, VGUIDefinitionReferences>()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				workspace: t.router({
					open: t
						.procedure
						.input(
							z.object({
								hudRoot: z.string()
							})
						)
						.mutation(async ({ input }) => {
							const { hudRoot } = input

							if (!this.HUDSchemes.has(hudRoot)) {
								this.HUDSchemes.set(hudRoot, await this.findHUDDefinitionReferences(hudRoot))
							}
						}),
					definition: t
						.procedure
						.input(
							z.object({
								hudRoot: z.string(),
								type: z.number(),
								key: z.string()
							})
						)
						.query(({ input }) => {
							const { hudRoot, type, key } = input

							const hudScheme = this.HUDSchemes.get(hudRoot)
							if (!hudScheme) {
								throw new Error("hudScheme is null")
							}

							const definitionReference = hudScheme.get([type, key])
							if (!definitionReference) {
								return null
							}

							const definitionLocation = definitionReference.getDefinitionLocation()
							if (!definitionLocation) {
								return null
							}

							return definitionLocation
						}),
					definitions: t
						.procedure
						.input(
							z.object({
								hudRoot: z.string(),
								type: z.number()
							})
						)
						.query(async ({ input }) => {
							const { hudRoot, type } = input

							const hudScheme = this.HUDSchemes.get(hudRoot)
							if (!hudScheme) {
								return {}
							}

							const keys: { [key: string]: any } = {}

							for (const definitionReference of hudScheme.ofType(type).values()) {
								if (definitionReference.getDefinitionLocation() != undefined && definitionReference.hasValue()) {
									keys[definitionReference.key] = definitionReference.getValue()
								}
							}

							return keys
						}),
					setReferences: t
						.procedure
						.input(
							z.object({
								hudRoot: z.string(),
								references: z.record(
									z.object({
										type: z.number(),
										key: z.string(),
										range: VDFRange.schema
									}).array()
								)
							})
						)
						.mutation(async ({ input }) => {
							const workspaceReferenceParams = input

							const hudScheme = this.HUDSchemes.get(workspaceReferenceParams.hudRoot)
							if (!hudScheme) {
								throw new Error(`Cannot set workspace references for hudScheme "${workspaceReferenceParams.hudRoot}" because it does not exist.`)
							}

							for (const uri in workspaceReferenceParams.references) {

								hudScheme.deleteReferences(uri)

								const references = workspaceReferenceParams.references[uri]

								for (const reference of references) {
									const range = new VDFRange(
										new VDFPosition(reference.range.start.line, reference.range.start.character),
										new VDFPosition(reference.range.end.line, reference.range.end.character)
									)
									hudScheme.get([reference.type, reference.key]).addReference(uri, range)
								}
							}

							this.codeLensRefresh()
						})
				})
			})
		)
	}

	private async findHUDDefinitionReferences(hudRoot: string): Promise<VGUIDefinitionReferences> {

		const documentDefinitionReferences = new VGUIDefinitionReferences(hudRoot, 4)

		for (const relativePath of new Set(VGUILanguageServer.HUDDefinitionReferences.flatMap((definitionReference) => definitionReference.files))) {

			let allowMultilineStrings = false

			// Only check location of entry file, assume default tf2 and vpk files dont use #base
			const uri = await (async (): Promise<string | null> => {

				const fileUri = `${hudRoot}/${relativePath}`
				if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
					return fileUri
				}

				const tfUri = normalizeUri(`file:///${(await this.connection.workspace.getConfiguration("vscode-vdf"))["teamFortress2Folder"]}/tf/${relativePath}`)
				if (await this.trpc.client.fileSystem.exists.query({ uri: tfUri })) {
					// The tf/resource directory contains tf_english.txt which uses multi-line strings.
					allowMultilineStrings = true
					return tfUri
				}

				const vpkUri = `vpk:///${relativePath}?vpk=misc`
				if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
					return vpkUri
				}

				return null
			})()

			if (!uri) {
				continue
			}

			await this.addDefinitions(
				VGUILanguageServer.HUDDefinitionReferences.filter((definitionReference) => definitionReference.files.includes(relativePath)),
				uri,
				documentDefinitionReferences,
				uri,
				allowMultilineStrings
			)
		}

		const iterateDirectory = (directoryUri: string): Promise<any>[] => {

			const promises: Promise<any>[] = []

			const directory = this.trpc.client.fileSystem.readDirectory.query({ uri: directoryUri })
			promises.push(directory)
			directory
				.then((entries) => {
					for (const [entry, type] of entries) {
						const entryUri = `${directoryUri}/${encodeURIComponent(entry)}`
						if (type == 2) {
							if (!entry.startsWith(".")) {
								// Ignore .git etc
								promises.push(...iterateDirectory(entryUri))
							}
						}
						else if (type == 1 && posix.extname(entry) == ".res") {
							const file = this.trpc.client.fileSystem.readFile.query({ uri: entryUri })
							promises.push(file)
							file
								.then((text) => {
									try {
										const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(entryUri, text)
										this.updateReferences(documentDefinitionReferences, entryUri, documentSymbols)
									}
									catch (error: any) {
										return
									}
								})
								.catch((error) => this.connection.console.log(error.stack))
						}
					}
				})
				.catch((error) => this.connection.console.log(error.stack))

			return promises
		}

		const promises = iterateDirectory(hudRoot)

		await Promise.allSettled(promises)

		return documentDefinitionReferences
	}

	private async addDefinitions(
		definitionReferencesConfigurations: VGUIDefinitionReferencesConfiguration[],
		definitionTypeEntryFileUri: string,
		documentDefinitionReferences: VGUIDefinitionReferences,
		uri: string,
		allowMultilineStrings: boolean
	): Promise<void> {
		try {

			const documentSymbols = this.documentsSymbols.get(uri)
				?? await (async (): Promise<VDFDocumentSymbols> => {
					const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(uri, await this.trpc.client.fileSystem.readFile.query({ uri }), { allowMultilineStrings })
					this.documentsSymbols.set(uri, documentSymbols)
					return documentSymbols
				})()

			const folderUri = posix.dirname(uri)
			const baseFiles: string[] = []

			// Add definition file even if no definitions are declared, since they can be added later e.g. If the entry file has only #base statements
			documentDefinitionReferences.addDefinitionFile(
				definitionReferencesConfigurations,
				definitionTypeEntryFileUri,
				allowMultilineStrings,
				uri,
			)

			documentSymbols.forAll((documentSymbol, objectPath) => {

				if (objectPath.length == 0 && documentSymbol.detail && this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase()) == "#base") {
					// Normalize for the definition files check because vscode always passes correct file Uris
					baseFiles.push(normalizeUri(`${folderUri}/${encodeBaseValue(documentSymbol.detail)}`))
				}

				definitionReferencesConfigurations.find((definitionReferenceConfiguration) => {

					if (objectPath.length > 0 && objectPath.length > definitionReferenceConfiguration.parentKeys.length) {
						// documentSymbol is inside an object that could be match a definition
						// Dont' check documentSymbols inside potential definition
						return
					}

					const definitionKey = documentSymbolMatchesDefinition(definitionReferenceConfiguration, documentSymbol, objectPath)
					if (definitionKey != null) {
						const definitionReference = documentDefinitionReferences.get([definitionReferenceConfiguration.type, definitionKey])
						if (definitionReference.getDefinitionLocation() == undefined) {

							const definitionIDKeyRange = definitionReferenceConfiguration.definitionIDKey != undefined
								? documentSymbol.children?.find((i) => i.key.toLowerCase() == definitionReferenceConfiguration.definitionIDKey && i.detail != undefined)?.detailRange
								: undefined

							documentDefinitionReferences.get([definitionReferenceConfiguration.type, definitionKey]).setDefinitionLocation({
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

							documentDefinitionReferences.addDefinitionFile(
								definitionReferencesConfigurations,
								definitionTypeEntryFileUri,
								allowMultilineStrings,
								uri,
								definitionReferenceConfiguration.type
							)
						}
					}
				})
			})

			for (const baseFileUri of await Promise.all(baseFiles)) {
				await this.addDefinitions(
					definitionReferencesConfigurations,
					definitionTypeEntryFileUri,
					documentDefinitionReferences,
					baseFileUri,
					allowMultilineStrings
				)
			}
		}
		catch (error: any) {
			this.connection.console.log(`[VGUILanguageServer.addDefinitions]: Error while adding definitions from "${uri}":\n${error.stack!}`)
		}
	}

	private async updateDefinitions(hudScheme: VGUIDefinitionReferences, definitionFile: DefinitionFile): Promise<void> {

		const types = new Set(definitionFile.configurations.map((configuration) => configuration.type))

		hudScheme.deleteDefinitionsOfTypes(types)
		hudScheme.deleteDefinitionFilesOfTypes(types)

		await this.addDefinitions(
			definitionFile.configurations,
			definitionFile.definitionTypeEntryFileUri,
			hudScheme,
			definitionFile.definitionTypeEntryFileUri,
			definitionFile.allowMultilineStrings
		)

		this.codeLensRefresh()
	}

	private async updateReferences(documentDefinitionReferences: DocumentDefinitionReferences, uri: string, documentSymbols: VDFDocumentSymbols): Promise<void> {

		documentDefinitionReferences.deleteReferences(uri)

		documentSymbols.forAll((documentSymbol) => {
			if (documentSymbol.children) {
				return
			}
			VGUILanguageServer.HUDDefinitionReferences.find((definitionReference) => {
				if (documentSymbolMatchesReferences(definitionReference, this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase()))) {
					const definitionReferencesValue = documentDefinitionReferences.get([
						definitionReference.type,
						definitionReference.transform ? definitionReference.transform(documentSymbol.detail!) : documentSymbol.detail!
					])
					definitionReferencesValue.addReference(uri, documentSymbol.detailRange!)
					return true
				}
				return false
			})
		})
	}

	protected async onDidOpen(e: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		super.onDidOpen(e)

		const hudRoot = (await this.trpc.client.searchForHUDRoot.query({ uri: e.document.uri }))?.toString() ?? null
		this.documentHUDRoots.set(e.document.uri, hudRoot)

		if (hudRoot && !this.HUDSchemes.has(hudRoot)) {
			try {
				this.HUDSchemes.set(hudRoot, await this.findHUDDefinitionReferences(hudRoot))
				this.codeLensRefresh()

				// await catch
				await this.trpc.servers.hudanimations.workspace.open.mutate({ hudRoot })
			}
			catch (error: any) {
				this.connection.console.log(error.stack!)
			}
		}

		if (hudRoot && e.document.uri == `${hudRoot}/scripts/hudanimations_manifest.txt`) {
			this.trpc.servers.hudanimations.workspace.setManifest.mutate({ hudRoot, documentSymbols: this.documentsSymbols.get(e.document.uri)! })
				.then((value) => console.log(value))
				.catch((error) => console.log(error))
		}
	}

	protected async onDidChangeContent(e: TextDocumentChangeEvent<TextDocument>): Promise<boolean> {

		const result = super.onDidChangeContent(e)
		if (!result) {
			// No change
			return result
		}

		const hudRoot = this.documentHUDRoots.get(e.document.uri)
		if (!hudRoot) {
			// File outside HUD cannot reference HUD definitions
			return result
		}

		const hudScheme = this.HUDSchemes.get(hudRoot)
		if (!hudScheme) {
			return result
		}

		const documentSymbols = this.documentsSymbols.get(e.document.uri)
		if (!documentSymbols) {
			return result
		}

		const definitionFile = hudScheme.getDefinitionFile(e.document.uri)
		if (definitionFile) {
			this.updateDefinitions(hudScheme, definitionFile)
		}

		this.updateReferences(hudScheme, e.document.uri, documentSymbols)

		if (e.document.uri == `${hudRoot}/scripts/hudanimations_manifest.txt`) {
			this.trpc.servers.hudanimations.workspace.setManifest.mutate({ hudRoot, documentSymbols })
				.then((value) => console.log(value))
				.catch((error) => console.log(error))
		}

		return result
	}

	protected onDidClose(e: TextDocumentChangeEvent<TextDocument>): void {
		super.onDidClose(e)
		this.documentHUDRoots.delete(e.document.uri)
	}

	protected async onCompletion(params: CompletionParams): Promise<CompletionItem[] | null> {

		const uri = params.textDocument.uri

		const hudRoot = this.documentHUDRoots.get(uri)

		if (!hudRoot) {
			return super.onCompletion(params)
		}

		const hudScheme = this.HUDSchemes.get(hudRoot)
		if (!hudScheme) {
			return super.onCompletion(params)
		}

		const definitionFile = hudScheme.getDefinitionFile(uri)
		if (!definitionFile) {
			return super.onCompletion(params)
		}

		return null
	}

	protected async validateDocumentSymbol(uri: string, documentSymbol: VDFDocumentSymbol, objectPath: string[]): Promise<Diagnostic | null> {

		const documentSymbolKey = documentSymbol.key.toLowerCase()

		const imageKeys = [
			"image",
			...Array.from({ length: 3 }).map((_, index) => `teambg_${index + 1}`)
		]

		if (imageKeys.includes(documentSymbolKey) && documentSymbol.detail != "") {

			const folder = "materials/vgui"
			const detail = encodeBaseValue(documentSymbol.detail!.toLowerCase())
			const newPath = posix.relative(folder, `${folder}/${detail}`)

			if (detail != newPath) {
				return {
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					code: "useless-path",
					message: "Unnecessary relative file path.",
					data: {
						documentSymbol: documentSymbol,
						newText: newPath
					}
				}
			}
		}

		if (documentSymbolKey == "pin_to_sibling") {
			const elementName = objectPath.at(-1)
			if (elementName && documentSymbol.detail!.toLowerCase() == elementName.toLowerCase()) {
				return {
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					code: "pin-self-reference",
					message: `Element '${elementName}' is pinned to itself.`,
				}
			}
		}

		return null
	}

	protected async getCompletionValues(uri: string, key: string, value: string): Promise<CompletionItem[] | null> {

		const hudRoot = this.documentHUDRoots.get(uri)

		if (["image", ...Array.from({ length: 3 }).map((_, index) => `teambg_${index + 1}`)].includes(key)) {
			return [
				...(
					hudRoot
						? await this.getFilesCompletion({ uri }, {
							uri: `${hudRoot}/materials/vgui`,
							relativePath: value,
							extensionsFilter: [".vmt"],
							displayExtensions: false
						})
						: []
				),
				...await this.getFilesCompletion({ uri }, {
					uri: "vpk:///materials/vgui",
					query: "?vpk=misc",
					relativePath: value,
					extensionsFilter: [".vmt"],
					displayExtensions: false
				})
			]
		}

		// HUD root required completion:
		if (!hudRoot) {
			return null
		}

		const hudScheme = this.HUDSchemes.get(hudRoot)
		if (!hudScheme) {
			return null
		}

		// Colours
		if (VGUILanguageServer.HUDDefinitionReferences.find((definitionReferencesConfiguration) => definitionReferencesConfiguration.type == VGUIDefinitionType.Colors)?.referenceKeys.has(key)) {
			return [...hudScheme.ofType(VGUIDefinitionType.Colors).values()]
				.filter((definitionReference) => definitionReference.getDefinitionLocation() != undefined)
				.map((definitionReference) => {

					let hex: string | undefined
					if (definitionReference.hasValue()) {
						try {
							const colours: number[] = definitionReference.getValue().split(/\s+/).map(parseFloat)

							const r = colours[0].toString(16).padStart(2, "0")
							const g = colours[1].toString(16).padStart(2, "0")
							const b = colours[2].toString(16).padStart(2, "0")

							hex = `#${r}${g}${b}`
						}
						catch (error: any) {
							this.connection.console.log(error.stack!)
							hex = undefined
						}
					}
					else {
						hex = undefined
					}

					return {
						label: definitionReference.key,
						kind: CompletionItemKind.Color,
						documentation: hex,
					}
				})
		}

		// Borders
		if (VGUILanguageServer.HUDDefinitionReferences.find((definitionReferencesConfiguration) => definitionReferencesConfiguration.type == VGUIDefinitionType.Borders)?.referenceKeys.has(key)) {
			return [...hudScheme.ofType(VGUIDefinitionType.Borders).values()]
				.filter((definitionReference) => definitionReference.getDefinitionLocation() != undefined)
				.map((definitionReference) => ({
					label: definitionReference.key,
					kind: CompletionItemKind.Snippet,
				}))
		}

		// Fonts
		if (VGUILanguageServer.HUDDefinitionReferences.find((definitionReferencesConfiguration) => definitionReferencesConfiguration.type == VGUIDefinitionType.Fonts)?.referenceKeys.has(key)) {
			return [...hudScheme.ofType(VGUIDefinitionType.Fonts).values()]
				.filter((definitionReference) => definitionReference.getDefinitionLocation() != undefined)
				.map((definitionReference) => ({
					label: definitionReference.key,
					kind: CompletionItemKind.Text,
				}))
		}

		// Language
		if (VGUILanguageServer.HUDDefinitionReferences.find((definitionReferencesConfiguration) => definitionReferencesConfiguration.type == VGUIDefinitionType.Language)?.referenceKeys.has(key)) {
			return [...hudScheme.ofType(VGUIDefinitionType.Language).values()]
				.filter((definitionReference) => definitionReference.getDefinitionLocation() != undefined)
				.map((definitionReference) => ({
					label: `#${definitionReference.key}`,
					// insertText: `#${definitionReference.key}`,
					kind: CompletionItemKind.Text,
				}))
		}

		return null
	}

	protected onDefinition(params: DefinitionParams): Definition | null {

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		const referenceDocumentSymbol = documentSymbols.getDocumentSymbolAtPosition(params.position)
		if (!referenceDocumentSymbol || !referenceDocumentSymbol.detailRange?.contains(params.position)) {
			return null
		}

		const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
		if (hudRoot) {

			const key = this.VDFLanguageServerConfiguration.keyHash(referenceDocumentSymbol.key.toLowerCase())

			const definitionsReferencesIndex = VGUILanguageServer.HUDDefinitionReferences.findIndex((value) => value.referenceKeys.has(key))

			if (definitionsReferencesIndex != -1) {
				let referencedKey = referenceDocumentSymbol.detail!
				if ((key == "title" || key == "labeltext") && referencedKey.startsWith("#")) {
					// Remove #
					referencedKey = referencedKey.substring(1)
				}
				const definitionLocation = this.HUDSchemes.get(hudRoot)?.get([definitionsReferencesIndex, referencedKey])?.getDefinitionLocation()
				return definitionLocation ?? null
			}
		}

		return super.onDefinition(params)
	}

	protected onReferences(params: ReferenceParams): Location[] | null {

		const uri = params.textDocument.uri

		const hudRoot = this.documentHUDRoots.get(uri)

		if (!hudRoot) {
			return super.onReferences(params)
		}

		const hudScheme = this.HUDSchemes.get(hudRoot)

		if (hudScheme) {
			const fileDefinitionTypes = hudScheme.getDefinitionFile(uri)?.fileDefinitionTypes
			// Ensure file Uri is a definition file
			if (fileDefinitionTypes) {
				const definitionKey = this.documentsSymbols.get(uri)?.getDocumentSymbolAtPosition(params.position)
				if (definitionKey) {
					if (definitionKey.nameRange.contains(params.position)) {
						for (const fileDefinitionType of fileDefinitionTypes) {
							for (const [, definitionReference] of hudScheme.ofType(fileDefinitionType)!) {
								const definitionLocation = definitionReference.getDefinitionLocation()
								if (definitionLocation) {
									if (definitionLocation.uri == uri && definitionKey.nameRange.contains(definitionLocation.range)) {
										return [...definitionReference.getReferences()]
									}
								}
							}
						}
					}
				}
			}
		}

		return super.onReferences(params)
	}

	protected onCodeLens(params: CodeLensParams): CodeLens[] | null {

		const uri = params.textDocument.uri

		const hudRoot = this.documentHUDRoots.get(uri)
		if (hudRoot) {
			const hudScheme = this.HUDSchemes.get(hudRoot)
			if (hudScheme) {
				const fileDefinitionTypes = hudScheme.getDefinitionFile(uri)?.fileDefinitionTypes
				if (fileDefinitionTypes) {

					const codeLens: CodeLens[] = []

					for (const fileDefinitionType of fileDefinitionTypes) {
						for (const [, definitionReference] of hudScheme.ofType(fileDefinitionType)) {
							const definitionLocation = definitionReference.getDefinitionLocation()

							if (definitionLocation?.uri == uri) {

								const references = [...definitionReference.getReferences()]

								if (references.length) {
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

						}
					}

					return codeLens
				}
			}
		}

		return super.onCodeLens(params)
	}

	protected onPrepareRename(params: PrepareRenameParams): Range | null {
		// Disable renaming in HUD definition files, there could be files that failed
		// to parse that reference HUD definitions or hard-coded clientscheme entries
		const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
		if (hudRoot) {
			const hudScheme = this.HUDSchemes.get(hudRoot)
			if (hudScheme) {
				if (hudScheme.getDefinitionFile(params.textDocument.uri)) {
					return null
				}
			}
		}
		return super.onPrepareRename(params)
	}
}
