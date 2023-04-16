import type { DocumentLinkData } from "$lib/types/DocumentLinkData"
import { rangeSchema } from "$lib/types/Range"
import { DocumentDefinitionReferences, documentSymbolMatchesDefinition, documentSymbolMatchesReferences } from "$lib/utils/definitionReferences"
import { encodeBaseValue } from "$lib/utils/encodeBaseValue"
import * as filesCompletion from "$lib/utils/filesCompletion"
import { getHUDRoot } from "$lib/utils/getHUDRoot"
import { normalizeUri } from "$lib/utils/normalizeUri"
import { VDFPosition } from "$lib/VDF/VDFPosition"
import { VDFRange } from "$lib/VDF/VDFRange"
import type { VDFDocumentSymbol } from "$lib/VDFDocumentSymbols/VDFDocumentSymbol"
import type { VDFDocumentSymbols } from "$lib/VDFDocumentSymbols/VDFDocumentSymbols"
import { dirname, extname, normalize, relative } from "path/posix"
import { CodeActionKind, CodeLens, CodeLensParams, Color, CompletionItem, CompletionItemKind, Connection, Definition, DefinitionParams, Diagnostic, DiagnosticSeverity, DocumentLink, Location, PrepareRenameParams, Range, ReferenceParams, TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { z } from "zod"
import { VDFLanguageServer } from "../VDFLanguageServer"
import type { VDFDefinitionReferencesConfiguration } from "../VDFLanguageServerConfiguration"
import clientscheme from "./clientscheme.json"
import keys from "./keys.json"
import values from "./values.json"
import { DefinitionFile, VGUIDefinitionReferences } from "./VGUIDefinitionReferences"

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
			type: index,
			files: ["resource/clientscheme.res"],
			parentKeys: ["Scheme".toLowerCase(), key.toLowerCase()],
			referenceKeys: new Set<string>(values)
		})),
		{
			type: VGUIDefinitionType.Language,
			files: ["resource/chat_english.txt", "resource/tf_english.txt"],
			parentKeys: ["lang", "Tokens".toLowerCase()],
			referenceKeys: new Set<string>([
				"labelText".toLowerCase(),
				"title"
			])
		}
	]

	protected readonly name: Extract<VDFLanguageServer["name"], "VDF">
	protected readonly languageId: Extract<VDFLanguageServer["languageId"], "vdf">
	private readonly documentHUDRoots: Map<string, string | null>
	private readonly HUDSchemes: Map<string, VGUIDefinitionReferences>

	constructor(name: VGUILanguageServer["name"], languageId: VGUILanguageServer["languageId"], connection: Connection) {
		super(name, languageId, connection, {
			servers: ["hudanimations"],
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
					parentKeys: [],
					definitionChildren: true,
					referenceKeys: new Set([
						"pin_to_sibling"
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
							const vmtPath = `${hudRoot}/${normalize(`materials/vgui/${documentLink.data.value}.vmt`)}`
							if (await this.fileSystem.exists(vmtPath)) {
								documentLink.target = vmtPath
								return documentLink
							}
						}
						documentLink.target = `vpk:///${normalize(`materials/vgui/${documentLink.data.value.toLowerCase()}.vmt`)}?vpk=misc`
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
							hudRoot = await getHUDRoot({ uri }, this.fileSystem)
						}

						const fileUri = `${hudRoot}/${encodeBaseValue(documentSymbol.detail!)}`
						if (await this.fileSystem.exists(fileUri)) {
							return true
						}

						const tfUri = `${this.documentsConfiguration.get(uri).teamFortress2Folder}/tf/${encodeBaseValue(documentSymbol.detail!)}`
						if (await this.fileSystem.exists(tfUri)) {
							return true
						}

						// No VPK Uri as VPKs cannot contain font files.

						return false
					},
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink | null> => {

						const hudRoot = this.documentHUDRoots.get(documentLink.data.uri)

						const fileUri = `${hudRoot}/${encodeBaseValue(documentLink.data.value)}`
						if (await this.fileSystem.exists(fileUri)) {
							documentLink.target = fileUri
							return documentLink
						}

						const tfUri = `${this.documentsConfiguration.get(documentLink.data.uri).teamFortress2Folder}/tf/${encodeBaseValue(documentLink.data.value)}`
						if (await this.fileSystem.exists(tfUri)) {
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
							if (await this.fileSystem.exists(hudFilePath)) {
								documentLink.target = hudFilePath
								return documentLink
							}
						}

						const vpkFilePath = `vpk:///${normalize(`${encodeBaseValue(documentLink.data.value.toLowerCase())}`)}?vpk=misc`
						if (await this.fileSystem.exists(vpkFilePath)) {
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
				key: "fieldName".toLowerCase()
			}
		})

		this.name = name
		this.languageId = languageId
		this.documentHUDRoots = new Map<string, string | null>()
		this.HUDSchemes = new Map<string, VGUIDefinitionReferences>()

		this.connection.onRequest("workspace/open", this.onWorkspaceOpen.bind(this))
		this.connection.onRequest("workspace/definition", this.onWorkspaceDefinition.bind(this))
		this.connection.onRequest("workspace/definitions", this.onWorkspaceDefinitions.bind(this))
		this.connection.onRequest("workspace/setReferences", this.onWorkspaceSetReferences.bind(this))
	}

	private async findHUDDefinitionReferences(hudRoot: string): Promise<VGUIDefinitionReferences> {

		const documentDefinitionReferences = new VGUIDefinitionReferences(hudRoot, 4)

		for (const relativePath of new Set(VGUILanguageServer.HUDDefinitionReferences.flatMap((definitionReference) => definitionReference.files))) {

			let allowMultilineStrings = false

			// Only check location of entry file, assume default tf2 and vpk files dont use #base
			const uri = await (async (): Promise<string | null> => {

				const fileUri = `${hudRoot}/${relativePath}`
				if (await this.fileSystem.exists(fileUri)) {
					return fileUri
				}

				const tfUri = normalizeUri(`file:///${(await this.connection.workspace.getConfiguration("vscode-vdf"))["teamFortress2Folder"]}/tf/${relativePath}`)
				if (await this.fileSystem.exists(tfUri)) {
					// The tf/resource directory contains tf_english.txt which uses multi-line strings.
					allowMultilineStrings = true
					return tfUri
				}

				const vpkUri = `vpk:///${relativePath}?vpk=misc`
				if (await this.fileSystem.exists(vpkUri)) {
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

			const directory = this.fileSystem.readDirectory(directoryUri)
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
						else if (type == 1 && extname(entry) == ".res") {
							const file = this.fileSystem.readFile(entryUri)
							promises.push(file)
							file
								.then((text) => {
									try {
										const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(text)
										this.updateReferences(documentDefinitionReferences, entryUri, documentSymbols)
									}
									catch (error: any) {
										return
									}
								})
								.catch(this.connection.console.log)
						}
					}
				})
				.catch(this.connection.console.log)

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
					const documentSymbols = this.languageServerConfiguration.parseDocumentSymbols(await this.fileSystem.readFile(uri), { allowMultilineStrings })
					this.documentsSymbols.set(uri, documentSymbols)
					return documentSymbols
				})()

			const folderUri = dirname(uri)
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
			VGUILanguageServer.HUDDefinitionReferences.find((definitionReference, index) => {
				if (documentSymbolMatchesReferences(definitionReference, this.VDFLanguageServerConfiguration.keyHash(documentSymbol.key.toLowerCase()))) {
					const definitionReferencesValue = documentDefinitionReferences.get([index, documentSymbol.detail!])
					definitionReferencesValue.addReference(uri, documentSymbol.detailRange!)
					return true
				}
				return false
			})
		})
	}

	protected async onDidOpen(e: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		super.onDidOpen(e)

		const hudRoot = await getHUDRoot(e.document, this.fileSystem)
		this.documentHUDRoots.set(e.document.uri, hudRoot)

		if (hudRoot && !this.HUDSchemes.has(hudRoot)) {
			try {
				this.HUDSchemes.set(hudRoot, await this.findHUDDefinitionReferences(hudRoot))
				this.codeLensRefresh()

				// await catch
				await this.connection.sendRequest("servers/sendRequest", ["hudanimations", "workspace/open", { hudRoot }])
			}
			catch (error: any) {
				this.connection.console.log(error.stack!)
			}
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
		else {
			this.updateReferences(hudScheme, e.document.uri, documentSymbols)
		}

		return result
	}

	protected onDidClose(e: TextDocumentChangeEvent<TextDocument>): void {
		super.onDidClose(e)
		this.documentHUDRoots.delete(e.document.uri)
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
			const newPath = relative(folder, `${folder}/${detail}`)

			if (detail != newPath) {
				return {
					message: "Unnecessary relative file path.",
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					data: {
						codeAction: {
							title: "Normalize file path.",
							edit: {
								changes: {
									[uri]: [
										{
											newText: newPath, // This is lower case
											range: documentSymbol.detailRange!
										}
									]
								}
							},
							isPreferred: true,
							kind: CodeActionKind.QuickFix
						}
					}
				}
			}
		}

		if (documentSymbolKey == "pin_to_sibling") {
			const elementName = objectPath.at(-1)
			if (elementName && documentSymbol.detail!.toLowerCase() == elementName.toLowerCase()) {
				return {
					message: `Element '${elementName}' is pinned to itself.`,
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
				}
			}
		}

		return null
	}

	protected async getCompletionValues(uri: string, key: string, value: string): Promise<CompletionItem[] | null> {

		const hudRoot = this.documentHUDRoots.get(uri)

		if (["image", ...Array.from({ length: 3 }).map((_, index) => `teambg_${index + 1}`)].includes(key)) {

			const configuration = this.documentsConfiguration.get(uri)

			const set = new filesCompletion.CompletionItemSet()

			if (configuration.filesAutoCompletionKind == "incremental") {

				// HUD files first
				if (hudRoot) {
					try {
						for (const item of await filesCompletion.incremental(this.connection, this.fileSystem, "", `${hudRoot}/materials/vgui`, value, [".vmt"], true)) {
							set.add(item)
						}
					}
					catch (error: any) {
						this.connection.console.log(error.stack!)
					}
				}

				try {
					for (const item of await filesCompletion.incremental(this.connection, this.fileSystem, "?vpk=misc", "vpk:///materials/vgui", value, [".vmt"], true)) {
						set.add(item)
					}
				}
				catch (error: any) {
					this.connection.console.log(error.stack!)
				}
			}
			else {

				if (hudRoot) {
					try {
						for (const item of await filesCompletion.all(this.connection, this.fileSystem, "", `${hudRoot}/materials/vgui`, [".vmt"], true)) {
							set.add(item)
						}
					}
					catch (error: any) {
						this.connection.console.log(error.stack!)
					}
				}

				try {
					for (const item of await filesCompletion.all(this.connection, this.fileSystem, "?vpk=misc", "vpk:///materials/vgui", [".vmt"], true)) {
						set.add(item)
					}
				}
				catch (error: any) {
					this.connection.console.log(error.stack!)
				}

			}

			return set.items
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
						for (const [, definitionReference] of hudScheme.ofType(fileDefinitionType)!) {
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

	private async onWorkspaceOpen(params: unknown): Promise<void> {

		const { hudRoot } = z.object({ hudRoot: z.string() }).parse(params)

		if (!this.HUDSchemes.has(hudRoot)) {
			this.HUDSchemes.set(hudRoot, await this.findHUDDefinitionReferences(hudRoot))
		}
	}

	private onWorkspaceDefinition(params: unknown): Definition | null {

		const { hudRoot, type, key } = z.object({
			hudRoot: z.string(),
			type: z.number(),
			key: z.string()
		}).parse(params)

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
	}

	private onWorkspaceDefinitions(params: unknown): { [key: string]: any } {

		const { hudRoot, type } = z.object({
			hudRoot: z.string(),
			type: z.number(),
		}).parse(params)

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
	}

	private async onWorkspaceSetReferences(params: unknown): Promise<void> {

		const workspaceReferenceParams = z.object({
			hudRoot: z.string(),
			references: z.record(
				z.object({
					type: z.number(),
					key: z.string(),
					range: rangeSchema
				}).array()
			)
		}).parse(params)

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
	}
}
