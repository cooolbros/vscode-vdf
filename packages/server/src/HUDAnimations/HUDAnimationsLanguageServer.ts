import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { HUDAnimationStatementType, HUDAnimationsDocumentSymbols, getHUDAnimationsDocumentSymbols } from "hudanimations-documentsymbols"
import { formatHUDAnimations, type HUDAnimationsFormatStringifyOptions } from "hudanimations-format"
import { VDFRange, VDFTokeniser, type VDFToken } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeAction, CodeActionKind, CodeLens, Command, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DiagnosticTag, DocumentLink, Location, Range, TextEdit, WorkspaceEdit, type CodeActionParams, type CodeLensParams, type CompletionParams, type Connection, type Definition, type DefinitionParams, type DocumentFormattingParams, type DocumentLinkParams, type PrepareRenameParams, type ReferenceParams, type RenameParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { z } from "zod"
import { DefinitionReference, DocumentDefinitionReferences } from "../DefinitionReferences"
import { LanguageServer } from "../LanguageServer"
import eventFiles from "./eventFiles.json"

export class HUDAnimationsLanguageServer extends LanguageServer<"hudanimations", HUDAnimationsDocumentSymbols> {

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

	private static readonly colourProperties = [
		"Ammo2Color",
		"BgColor",
		"FgColor",
		"ItemColor",
		"MenuColor"
	]

	private static readonly fontProperties = [
		"delta_item_font_big",
		"delta_item_font",
		"font",
		"ItemFont",
		"ItemFontPulsing",
		"NumberFont",
		"TextFont",
		"TFFont"
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

	private readonly documentHUDRoots: Map<string, string | null>
	private readonly workspaceHUDAnimationsManifests: Map<string, Set<string>>
	private readonly documentsDefinitionReferences: Map<string, DocumentDefinitionReferences>

	private oldName: string | null

	constructor(languageId: "hudanimations", name: "HUD Animations", connection: Connection) {
		super(languageId, name, connection, {
			servers: new Set(["vdf"]),
			parseDocumentSymbols: (uri, str) => getHUDAnimationsDocumentSymbols(str),
			defaultDocumentSymbols: () => new HUDAnimationsDocumentSymbols()
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
				resolveProvider: false
			},
			documentLinkProvider: {
				resolveProvider: true,
			},
			documentFormattingProvider: true,
			renameProvider: {
				prepareProvider: true
			}
		})

		this.documentHUDRoots = new Map<string, string | null>()
		this.workspaceHUDAnimationsManifests = new Map<string, Set<string>>()
		this.documentsDefinitionReferences = new Map<string, DocumentDefinitionReferences>()

		this.oldName = null

		this.onTextDocumentRequest(this.connection.onCompletion, (params) => !this.documentsConfiguration.get(params.textDocument.uri)[this.languageId].suggest.enable ? null : this.onCompletion(params))
		this.onTextDocumentRequest(this.connection.onDefinition, this.onDefinition)
		this.onTextDocumentRequest(this.connection.onReferences, this.onReferences)
		this.onTextDocumentRequest(this.connection.onCodeAction, this.onCodeAction)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(this.connection.onCodeLens, this.onCodeLens)
		this.onTextDocumentRequest(this.connection.onDocumentLinks, this.onDocumentLinks)

		this.connection.onDocumentLinkResolve(this.onDocumentLinkResolve.bind(this))

		this.onTextDocumentRequest(this.connection.onDocumentFormatting, this.onDocumentFormatting)
		this.onTextDocumentRequest(this.connection.onPrepareRename, this.onPrepareRename)
		this.onTextDocumentRequest(this.connection.onRenameRequest, this.onRenameRequest)
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
							await this.findHUDDefinitionReferences(hudRoot)
						}),
					setManifest: t
						.procedure
						.input(
							z.object({
								hudRoot: z.string(),
								documentSymbols: VDFDocumentSymbols.schema
							})
						)
						.mutation(async ({ input }) => {
							const { hudRoot, documentSymbols } = input

							const files = documentSymbols
								.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")
								?.children
								?.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "file" && documentSymbol.detail != undefined)
								.map((documentSymbol) => documentSymbol.detail!)
								?? []

							this.workspaceHUDAnimationsManifests.set(
								hudRoot,
								new Set(files)
							)
						})
				})
			})
		)
	}

	private async findHUDDefinitionReferences(hudRoot: string, request?: Promise<void>): Promise<void> {

		const hudAnimationsManifestPath = await (async (): Promise<string | null> => {
			const fileHUDAnimationsManifestPath = `${hudRoot}/scripts/hudanimations_manifest.txt`
			if (await this.trpc.client.fileSystem.exists.query({ uri: fileHUDAnimationsManifestPath })) {
				return fileHUDAnimationsManifestPath
			}
			else {
				const vpkHUDAnimationsManifestPath = "vpk:///scripts/hudanimations_manifest.txt?vpk=misc"
				if (await this.trpc.client.fileSystem.exists.query({ uri: vpkHUDAnimationsManifestPath })) {
					return vpkHUDAnimationsManifestPath
				}
			}
			return null
		})()

		if (!hudAnimationsManifestPath) {
			return
		}

		const files = await (async (): Promise<string[] | null> => {
			try {
				const manifestDocumentSymbols = await this.trpc.servers.vgui.textDocument.documentSymbol.query({ uri: hudAnimationsManifestPath })

				const hudanimations_manifest = manifestDocumentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")
				if (!hudanimations_manifest || hudanimations_manifest.children == undefined) {
					return null
				}

				return hudanimations_manifest.children
					.filter((documentSymbol): documentSymbol is VDFDocumentSymbol & { detail: string } => documentSymbol.key.toLowerCase() == "file" && documentSymbol.detail != undefined)
					.map((documentSymbol) => documentSymbol.detail)
			}
			catch (error: any) {
				this.connection.console.log(error.stack)
				return null
			}
		})()

		if (!files) {
			return
		}

		this.workspaceHUDAnimationsManifests.set(hudRoot, new Set(files))

		const workspaceReferences: { hudRoot: string, references: { [key: string]: { type: number, key: string, range: VDFRange }[] } } = { hudRoot, references: {} }

		for (const file of files) {
			try {

				const uri = await (async (): Promise<string | null> => {
					const fileUri = `${hudRoot}/${file}`
					if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
						return fileUri
					}
					else {
						const vpkUri = `vpk:///${file}?vpk=misc`
						if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
							return vpkUri
						}
					}
					return null
				})()

				if (!uri) {
					continue
				}

				const document = this.documents.get(uri)
				if (document) {
					// Send new diagnostics now that workspaceHUDAnimationsManifests is set
					this.onDidChangeContent({ document })
				}

				if (!this.documentsSymbols.has(uri)) {
					this.documentsSymbols.set(uri, getHUDAnimationsDocumentSymbols(await this.trpc.client.fileSystem.readFile.query({ uri })))
				}

				await this.onDefinitionReferences(uri, workspaceReferences)
			}
			catch (error: any) {
				this.connection.console.log(error.stack)
				return
			}
		}

		await request
		await this.trpc.servers.vgui.workspace.setReferences.mutate(workspaceReferences)
	}

	protected async onDidOpen(e: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		super.onDidOpen(e)

		const hudRoot = (await this.trpc.client.searchForHUDRoot.query({ uri: e.document.uri }))?.toString() ?? null
		this.documentHUDRoots.set(e.document.uri, hudRoot)

		this.onDefinitionReferences(e.document.uri)
		this.onDecoration(e)

		if (hudRoot) {
			const request = this.trpc.servers.vgui.workspace.open.mutate({ hudRoot })
			await this.findHUDDefinitionReferences(hudRoot, request)
		}
	}

	protected async onDidChangeContent(e: TextDocumentChangeEvent<TextDocument>): Promise<boolean> {
		const result = super.onDidChangeContent(e)
		this.onDecoration(e)
		return result
	}

	protected onDidClose(e: TextDocumentChangeEvent<TextDocument>): void {
		super.onDidClose(e)
		this.documentsDefinitionReferences.delete(e.document.uri)
	}

	protected async validateTextDocument(uri: string, documentSymbols: HUDAnimationsDocumentSymbols): Promise<Diagnostic[]> {

		const hudRoot = this.documentHUDRoots.get(uri)

		const [documentDefinitionReferences, allEvents] = await Promise.all([
			this.onDefinitionReferences(uri),
			(async (): Promise<Set<string>[]> => {
				if (!hudRoot) {
					return []
				}

				const absolutePaths = await Promise.all(
					[...(this.workspaceHUDAnimationsManifests.get(hudRoot) ?? [])]
						.map(async (relativePath) => {
							const fileUri = `${hudRoot}/${relativePath}`
							if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
								return fileUri
							}
							else {
								const vpkUri = `vpk:///${relativePath}?vpk=misc`
								if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
									return vpkUri
								}
							}
							return null
						})
				).then((value) => value.filter((v): v is string => Boolean(v) && v != uri))

				const eventNames = await Promise.all(
					absolutePaths.map(async (absolutePath) => {
						let documentSymbols = this.documentsSymbols.get(absolutePath)
						if (!documentSymbols) {
							documentSymbols = getHUDAnimationsDocumentSymbols(await this.trpc.client.fileSystem.readFile.query({ uri: absolutePath }))
							this.documentsSymbols.set(absolutePath, documentSymbols)
						}

						return new Set(documentSymbols.map((value) => value.eventName.toLowerCase()))
					})
				)

				return eventNames
			})()
		])

		const diagnostics: Diagnostic[] = []
		const events = new Set<string>()

		for (const event of documentSymbols) {

			// Check duplicate events
			const eventKey = JSON.stringify({ event: event.eventName.toLowerCase(), conditional: event.conditional?.value.toLowerCase() })
			if (events.has(eventKey)) {
				diagnostics.push({
					range: event.range,
					severity: DiagnosticSeverity.Hint,
					code: "duplicate-event",
					message: "Unreachable code detected.",
					tags: [
						DiagnosticTag.Unnecessary
					],
					data: {
						documentSymbol: event
					}
				})
			}
			else {
				events.add(eventKey)
			}

			for (const statement of event.children) {
				switch (statement.type) {
					case HUDAnimationStatementType.RunEvent:
					case HUDAnimationStatementType.StopEvent: {
						const referencedEventName = statement.event.toLowerCase()
						if (documentDefinitionReferences.get([0, referencedEventName]).getDefinitionLocation() == undefined && allEvents.every((set) => !set.has(referencedEventName))) {
							diagnostics.push({
								range: statement.eventRange,
								severity: DiagnosticSeverity.Warning,
								code: "invalid-reference",
								message: `Cannot find event '${statement.event}'.`,
							})
						}
						break
					}
				}
			}
		}

		return diagnostics
	}

	protected async onDefinitionReferences(uri: string, workspaceReferences?: { hudRoot: string, references: { [key: string]: { type: number, key: string, range: VDFRange }[] } }): Promise<DocumentDefinitionReferences> {

		const documentDefinitionReferences = new DocumentDefinitionReferences(1)

		const documentSymbols = this.documentsSymbols.get(uri)
		if (!documentSymbols) {
			return documentDefinitionReferences
		}

		let hudRoot = this.documentHUDRoots.get(uri)
		if (hudRoot === undefined) {
			hudRoot = (await this.trpc.client.searchForHUDRoot.query({ uri }))?.toString() ?? null
			this.documentHUDRoots.set(uri, hudRoot)
		}

		const filesReferences: { [definitionUri: string]: { [referenceUri: string]: { type: number, key: string, range: VDFRange }[] } } = {}
		const filesReferencesPromises: Promise<void>[] = []

		if (hudRoot !== null) {
			workspaceReferences ??= { hudRoot, references: {} }
		}

		for (const event of documentSymbols) {

			const eventName = event.eventName.toLowerCase()

			const definitionReference = documentDefinitionReferences.get([0, eventName])

			if (!definitionReference.getDefinitionLocation()) {
				definitionReference.setDefinitionLocation({ definitionLocation: { uri: uri, range: event.eventNameRange }, value: null })
			}

			for (const statement of event.children) {

				if (hudRoot && statement.type == HUDAnimationStatementType.Animate || statement.type == HUDAnimationStatementType.RunEventChild) {

					// @ts-ignore
					const eventFile: string | string[] | undefined = eventFiles[event.eventName.toLowerCase()]
					if (eventFile) {

						for (const relativePath of typeof eventFile == "object" ? eventFile : [eventFile]) {

							filesReferencesPromises.push((async (): Promise<void> => {

								const definitionFileUri = await (async (): Promise<string | null> => {
									const fileUri = `${hudRoot}/${relativePath}`
									if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
										return fileUri
									}
									else {
										const vpkUri = `vpk:///${relativePath}?vpk=misc`
										if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
											return vpkUri
										}
									}
									return null
								})()

								if (!definitionFileUri) {
									return
								}

								filesReferences[definitionFileUri] ??= {}
								filesReferences[definitionFileUri][uri] ??= []
								filesReferences[definitionFileUri][uri].push({ type: 0, key: statement.element, range: statement.elementRange })
							})())
						}
					}
				}

				if (statement.type == HUDAnimationStatementType.RunEvent || statement.type == HUDAnimationStatementType.StopEvent || statement.type == HUDAnimationStatementType.RunEventChild) {
					documentDefinitionReferences
						.get([0, statement.event.toLowerCase()])
						.addReference(uri, statement.eventRange)
				}

				if (workspaceReferences) {
					// Scheme
					if (statement.type == HUDAnimationStatementType.Animate && HUDAnimationsLanguageServer.colourProperties.some((i) => i.toLowerCase() == statement.property.toLowerCase())) {
						workspaceReferences.references[uri] ??= []
						workspaceReferences.references[uri].push({ type: 0, key: statement.value, range: statement.valueRange })
					}

					if (statement.type == HUDAnimationStatementType.SetFont && HUDAnimationsLanguageServer.fontProperties.some((i) => i.toLowerCase() == statement.property.toLowerCase())) {
						workspaceReferences.references[uri] ??= []
						workspaceReferences.references[uri].push({ type: 2, key: statement.value, range: statement.valueRange })
					}
				}
			}
		}

		this.documentsDefinitionReferences.set(uri, documentDefinitionReferences)

		// Ignore error if the VDF language server is not started yet.
		// findHUDDefinitionReferences will await the request and
		// call onDefinitionReferences again

		Promise.all(filesReferencesPromises).then(() => {
			for (const definitionUri in filesReferences) {
				this.trpc.servers.vgui.files.setReferences.query({ uri: definitionUri, references: filesReferences[definitionUri] })
					.catch((error: any) => this.connection.console.log(error.message))
			}
		})

		if (workspaceReferences) {
			this.trpc.servers.vgui.workspace.setReferences.mutate(workspaceReferences)
				.catch((error: any) => this.connection.console.log(error.message))
		}

		this.codeLensRefresh()

		return documentDefinitionReferences
	}

	protected async onCompletion(params: CompletionParams): Promise<CompletionItem[] | null> {

		const document = this.documents.get(params.textDocument.uri)
		if (!document) {
			return null
		}

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		try {
			const eventDocumentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(params.position))

			let line = document.getText({ start: { line: params.position.line, character: 0 }, end: params.position })

			// When editor.autoClosingQuotes, line ends with '"'
			// Remove last character from line so it can parse
			if (line.endsWith("\"")) {
				line = line.slice(0, line.length - 1)
			}

			if (!eventDocumentSymbol && !line.includes("event")) {
				return [{ label: "event", kind: CompletionItemKind.Keyword }]
			}

			const tokeniser = new VDFTokeniser(line)

			const tokens: VDFToken[] = []
			let token: VDFToken | null
			while ((token = tokeniser.next())) {
				tokens.push(token)
			}

			function startsWithFilter(text: string): (completionItem: CompletionItem) => boolean {
				text = text.toLowerCase()
				return (completionItem: CompletionItem) => completionItem.label.toLowerCase().startsWith(text)
			}

			const keywords = async (text?: string): Promise<CompletionItem[]> => {
				const keywords = HUDAnimationsLanguageServer.keywords.map((keyword) => ({ label: keyword, kind: CompletionItemKind.Variable }))
				return text
					? keywords.filter(startsWithFilter(text))
					: keywords
			}

			const elements = async (text?: string): Promise<CompletionItem[]> => {

				const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
				if (!hudRoot) {
					return []
				}

				if (!eventDocumentSymbol) {
					return []
				}

				// @ts-ignore
				const eventFile: string | string[] | undefined = eventFiles[eventDocumentSymbol.eventName.toLowerCase()]
				if (!eventFile) {
					return []
				}

				return (
					await Promise.all(
						(typeof eventFile == "string" ? [eventFile] : eventFile).map(async (relativePath) => {
							const uri = `${hudRoot}/${relativePath}`
							const keys = await this.trpc.servers.vgui.files.documentSymbolKeys.query({ uri })
							return keys.filter((key) => text ? key.startsWith(text) : true).map((key) => ({
								label: key,
								kind: CompletionItemKind.Variable
							}))
						})
					)
				).flat()
			}

			const properties = async (text?: string): Promise<CompletionItem[]> => {
				const properties = HUDAnimationsLanguageServer.properties.map((property) => ({ label: property, kind: CompletionItemKind.Keyword }))
				return text
					? properties.filter(startsWithFilter(text))
					: properties
			}

			const fontProperties = async (text?: string): Promise<CompletionItem[]> => {
				const properties = HUDAnimationsLanguageServer.fontProperties.map((property) => ({ label: property, kind: CompletionItemKind.Keyword }))
				return text
					? properties.filter(startsWithFilter(text))
					: properties
			}

			// Workspace Clientscheme Colours
			const colours = async (text?: string): Promise<CompletionItem[]> => {

				const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
				if (!hudRoot) {
					return []
				}

				const colourDefinitions = await this.trpc.servers.vgui.workspace.definitions.query({ hudRoot: hudRoot, type: 0 })

				const items: CompletionItem[] = []

				for (const key in colourDefinitions) {

					let hex: string | undefined
					try {
						const colours: number[] = colourDefinitions[key].split(/\s+/).map(parseFloat)

						const r = colours[0].toString(16).padStart(2, "0")
						const g = colours[1].toString(16).padStart(2, "0")
						const b = colours[2].toString(16).padStart(2, "0")

						hex = `#${r}${g}${b}`
					}
					catch (error: any) {
						this.connection.console.log(error.stack!)
						hex = undefined
					}

					items.push({
						label: key,
						kind: CompletionItemKind.Color,
						documentation: hex,
					})
				}

				return text
					? items.filter(startsWithFilter(text))
					: items
			}

			const fonts = async (text?: string): Promise<CompletionItem[]> => {

				const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
				if (!hudRoot) {
					return []
				}

				const fontDefinitions = await this.trpc.servers.vgui.workspace.definitions.query({ hudRoot: hudRoot, type: 2 })

				const items: CompletionItem[] = []

				for (const key in fontDefinitions) {
					items.push({
						label: key,
						kind: CompletionItemKind.Text,
					})
				}

				return text
					? items.filter(startsWithFilter(text))
					: items
			}

			const interpolators = async (text?: string): Promise<CompletionItem[]> => {
				const interpolators = HUDAnimationsLanguageServer.interpolators.map((interpolator) => ({ label: interpolator, kind: CompletionItemKind.Keyword }))
				return text
					? interpolators.filter(startsWithFilter(text))
					: interpolators
			}

			const events = async (text?: string): Promise<CompletionItem[]> => {
				const events = documentSymbols!.map((documentSymbol) => ({ label: documentSymbol.eventName, kind: CompletionItemKind.Event }))
				return text
					? events.filter(startsWithFilter(text))
					: events
			}

			const sounds = async (text?: string): Promise<CompletionItem[]> => {

				let relativePath: string | undefined = undefined
				let search: string | undefined = undefined

				if (text) {
					const folders = text.split("/")
					search = folders.pop()?.toLowerCase()
					relativePath = folders.join("/")
				}

				return this.getFilesCompletion(params.textDocument, {
					uri: "vpk:///sound",
					query: "?vpk=sound_misc",
					relativePath: relativePath,
					startsWithFilter: search,
					extensionsFilter: [".mp3", ".wav"],
					displayExtensions: false,
				})
			}

			if (tokens.length == 0) {
				return keywords()
			}
			else if (tokens.length == 1 && line.endsWith(tokens[0].value)) {
				return keywords(tokens[0].value.toLowerCase())
			}

			switch (tokens[0].value.toLowerCase()) {
				case "animate":
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: properties()
						}
						case 3: {
							if (line.endsWith(tokens[2].value)) {
								return properties(tokens[2].value.toLowerCase())
							}

							if (HUDAnimationsLanguageServer.colourProperties.some((i) => i.toLowerCase() == tokens[2].value.toLowerCase())) {
								return colours()
							}

							break
						}
						case 4: {
							return line.endsWith(tokens[3].value)
								? colours(tokens[3].value.toLowerCase())
								: interpolators()
						}
						case 5: {
							return line.endsWith(tokens[4].value)
								? interpolators(tokens[4].value.toLowerCase())
								: []
						}
					}
					break
				case "runevent":
				case "stopevent": {
					switch (tokens.length) {
						case 1: {
							return events()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? events(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
				case "setvisible": {
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
				case "firecommand": {
					return null
				}
				case "runeventchild": {
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: events()
						}
						case 3: {
							return line.endsWith(tokens[2].value)
								? events(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
				case "setinputenabled": {
					switch (tokens.length) {
						case 1: {
							return []
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
				case "playsound": {
					switch (tokens.length) {
						case 1: {
							return []
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? []
								: sounds()
						}
						case 3: {
							if (line.endsWith(tokens[2].value)) {
								return sounds(tokens[2].value.toLowerCase())
							}
							return []
						}
					}
					break
				}
				case "stoppanelanimations": {
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
				case "setfont": {
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: fontProperties()
						}
						case 3: {
							return line.endsWith(tokens[2].value)
								? fontProperties(tokens[2].value.toLowerCase())
								: fonts()
						}
						case 4: {
							return line.endsWith(tokens[3].value)
								? fonts(tokens[3].value.toLowerCase())
								: [] // Delay
						}
					}
					break
				}
				case "settexture":
				case "setstring": {
					switch (tokens.length) {
						case 1: {
							return elements()
						}
						case 2: {
							return line.endsWith(tokens[1].value)
								? elements(tokens[1].value.toLowerCase())
								: []
						}
					}
					break
				}
			}

			return null
		}
		catch (error: any) {
			this.connection.console.log(error.stack!)
			return null
		}
	}

	protected async onDefinition(params: DefinitionParams): Promise<Definition | null> {

		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		const documentSymbol = documentSymbols.getHUDAnimationStatementAtPosition(params.position)
		if (!documentSymbol) {
			return null
		}

		switch (documentSymbol.type) {
			case HUDAnimationStatementType.Animate: {

				const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)

				if (documentSymbol.elementRange.contains(params.position)) {

					const eventDocumentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(params.position))
					if (!eventDocumentSymbol) {
						this.connection.console.log("No eventDocumentSymbol")
						return null
					}

					// @ts-ignore
					const eventFile: string | string[] | undefined = eventFiles[eventDocumentSymbol.eventName.toLowerCase()]
					if (!eventFile) {
						this.connection.console.log(`No eventFile found for ${eventDocumentSymbol.eventName}`)
						return null
					}

					const element = documentSymbol.element.toLowerCase()

					if (Array.isArray(eventFile)) {

						const locations = (
							await Promise.all(
								eventFile
									.map(async (relativePath) => {
										const fileUri = `${hudRoot}/${relativePath}`
										const vpkUri = `vpk:///${relativePath}?vpk=misc`
										return this.trpc.servers.vgui.files.documentSymbolLocation.query({ uris: [fileUri, vpkUri], key: element })
									})
							)).
							filter((location) => location != null)

						return locations
					}
					else {
						const fileUri = `${hudRoot}/${eventFile}`
						const vpkUri = `vpk:///${eventFile}?vpk=misc`
						return this.trpc.servers.vgui.files.documentSymbolLocation.query({ uris: [fileUri, vpkUri], key: element })
					}
				}
				else if (hudRoot && documentSymbol.valueRange.contains(params.position)) {
					return this.trpc.servers.vgui.workspace.definition.query({ hudRoot, type: 0, key: documentSymbol.value.toLowerCase() })
				}
				break
			}
			case HUDAnimationStatementType.RunEvent:
			case HUDAnimationStatementType.StopEvent:
			case HUDAnimationStatementType.RunEventChild: {
				if (documentSymbol.eventRange.contains(params.position)) {
					const eventName = documentSymbol.event.toLowerCase()

					const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
					const files = hudRoot ? this.workspaceHUDAnimationsManifests.get(hudRoot) : null

					if (!files) {
						return documentSymbols
							.filter((event) => event.eventName == eventName)
							.map((event): Location => ({
								uri: params.textDocument.uri,
								range: event.eventNameRange
							}))
					}
					else {
						const locations: Location[] = []
						const absolutePaths = await Promise.all(
							[...files]
								.map(async (relativePath) => {
									const fileUri = `${hudRoot}/${relativePath}`
									if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
										return fileUri
									}
									else {
										const vpkUri = `vpk:///${relativePath}?vpk=misc`
										if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
											return vpkUri
										}
									}
									return null
								})
						).then((value) => value.filter((v): v is string => Boolean(v)))

						const eventNames = await Promise.all(
							absolutePaths.map(async (absolutePath) => {
								let documentSymbols = this.documentsSymbols.get(absolutePath)
								if (!documentSymbols) {
									documentSymbols = getHUDAnimationsDocumentSymbols(await this.trpc.client.fileSystem.readFile.query({ uri: absolutePath }))
									this.documentsSymbols.set(absolutePath, documentSymbols)
								}

								return { uri: absolutePath, documentSymbols: documentSymbols }
							})
						)

						for (const { uri, documentSymbols } of eventNames) {
							for (const event of documentSymbols) {
								if (event.eventName.toLowerCase() == eventName) {
									locations.push({
										uri: uri,
										range: event.eventNameRange
									})
								}
							}
						}

						return locations
					}
				}
				break
			}
			case HUDAnimationStatementType.SetFont: {
				const hudRoot = this.documentHUDRoots.get(params.textDocument.uri)
				if (hudRoot) {
					return this.trpc.servers.vgui.workspace.definition.query({ hudRoot, type: 2, key: documentSymbol.value.toLowerCase() })
				}
				break
			}
			default:
				break
		}

		return null
	}

	protected onReferences(params: ReferenceParams): Location[] | null {

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (!documentDefinitionReferences) {
			return null
		}

		let definitionReferenceInfo: DefinitionReference | null = null
		for (const [, , definitionReference] of documentDefinitionReferences) {
			if (definitionReference.getDefinitionLocation()?.uri == params.textDocument.uri && definitionReference.getDefinitionLocation()?.range.contains(params.position)) {
				definitionReferenceInfo = definitionReference
				break
			}
		}

		if (definitionReferenceInfo == null) {
			return null
		}

		return [...definitionReferenceInfo.getReferences()]
	}

	protected onCodeAction(params: CodeActionParams): (Command | CodeAction)[] {

		const diagnosticDataSchema = z.object({
			documentSymbol: z.any().transform((arg) => <VDFDocumentSymbol>arg),
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

			const { documentSymbol } = result.data

			switch (diagnostic.code) {
				case "duplicate-event": {
					codeActions.push({
						title: "Remove duplicate event",
						kind: CodeActionKind.QuickFix,
						diagnostics: [diagnostic],
						isPreferred: true,
						edit: {
							changes: {
								[uri]: [
									{
										range: documentSymbol.range,
										newText: "",
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

	private onDocumentLinks(params: DocumentLinkParams): DocumentLink[] | null {


		const documentSymbols = this.documentsSymbols.get(params.textDocument.uri)
		if (!documentSymbols) {
			return null
		}

		const links: DocumentLink[] = []

		for (const event of documentSymbols) {
			for (const statement of event.children) {
				if (statement.type == HUDAnimationStatementType.PlaySound) {
					links.push({
						range: statement.soundRange,
						data: {
							uri: params.textDocument.uri,
							sound: statement.sound
						}
					})
				}
			}
		}

		return links
	}

	private async onDocumentLinkResolve(documentLink: DocumentLink): Promise<DocumentLink | null> {

		const uri: string = documentLink.data.uri
		const sound: string = documentLink.data.sound

		const hudRoot = this.documentHUDRoots.get(uri)

		if (hudRoot) {
			const fileUri = `${hudRoot}/sound/${sound}`
			if (await this.trpc.client.fileSystem.exists.query({ uri: fileUri })) {
				documentLink.target = fileUri
				return documentLink
			}
		}

		const vpkUri = `vpk:///sound/${sound}?vpk=sound_misc`

		if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
			documentLink.target = vpkUri
			return documentLink
		}

		return null
	}

	private onDocumentFormatting(params: DocumentFormattingParams): TextEdit[] | null {

		const document = this.documents.get(params.textDocument.uri)

		if (!document) {
			return null
		}

		try {

			const documentConfiguration = this.documentsConfiguration.get(params.textDocument.uri)[this.languageId].format

			const options: HUDAnimationsFormatStringifyOptions = {
				layoutScope: documentConfiguration.layoutScope,
				tabs: documentConfiguration.tabs ?? 1,
				breakAfterEvent: documentConfiguration.insertNewlineAfterEvents,
				insertFinalNewline: params.options.insertFinalNewline ?? false,
			}

			this.connection.console.log(JSON.stringify(params.options))
			this.connection.console.log(JSON.stringify(options))

			const MAX_VALUE = ((2 ** 31) - 1)

			return [
				{
					range: Range.create(0, 0, MAX_VALUE, MAX_VALUE),
					newText: formatHUDAnimations(document.getText(), options),
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

		for (const [, key, definitionReference] of documentDefinitionReferences) {

			const definitionLocation = definitionReference.getDefinitionLocation()
			if (definitionLocation?.uri == params.textDocument.uri && definitionLocation?.range.contains(params.position)) {
				this.oldName = key
				return definitionLocation.range
			}

			for (const reference of definitionReference.getReferences()) {
				if (reference.uri == params.textDocument.uri && reference.range.contains(params.position)) {
					this.oldName = key
					return reference.range
				}
			}
		}

		return null
	}

	protected onRenameRequest(params: RenameParams): WorkspaceEdit | null {

		if (!this.oldName) {
			throw new Error("oldName is undefined")
		}

		const changes: { [uri: string]: TextEdit[] } = {}

		const documentDefinitionReferences = this.documentsDefinitionReferences.get(params.textDocument.uri)
		if (!documentDefinitionReferences) {
			return null
		}

		for (const [, key, definitionReference] of documentDefinitionReferences) {

			if (key == this.oldName) {

				const definitionLocation = definitionReference.getDefinitionLocation()
				if (definitionLocation) {
					changes[definitionLocation.uri] ??= []
					changes[definitionLocation.uri].push(TextEdit.replace(definitionLocation.range, params.newName))
				}

				for (const reference of definitionReference.getReferences()) {
					changes[reference.uri] ??= []
					changes[reference.uri].push(TextEdit.replace(reference.range, params.newName))
				}
			}
		}

		this.oldName = null
		this.codeLensRefresh()

		return { changes }
	}

	private onDecoration(params: TextDocumentChangeEvent<TextDocument>): void {

		const { uri } = params.document

		const documentSymbols = this.documentsSymbols.get(uri)
		if (!documentSymbols) {
			return
		}

		const decorations: any[] = []

		for (const event of documentSymbols) {

			const eventName = event.eventName.toLowerCase()

			if (eventName in eventFiles) {

				// @ts-ignore
				const eventFile = eventFiles[eventName]

				decorations.push({
					range: event.conditional?.range ?? event.eventNameRange,
					renderOptions: {
						after: {
							contentText: Array.isArray(eventFile) ? eventFile.join(", ") : eventFile
						}
					}
				})
			}
		}

		this.connection.sendRequest("textDocument/decoration", [uri, decorations])
	}
}
