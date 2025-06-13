import type { initTRPC, TRPCCombinedDataTransformer } from "@trpc/server"
import { Uri } from "common/Uri"
import { generateTokens } from "common/generateTokens"
import { HUDAnimationsDocumentSymbols } from "hudanimations-documentsymbols"
import { formatHUDAnimations, type HUDAnimationsFormatStringifyOptions } from "hudanimations-format"
import { firstValueFrom, Observable, Subscription } from "rxjs"
import { VDFPosition } from "vdf"
import type { VDFDocumentSymbols } from "vdf-documentsymbols"
import { CompletionItem, CompletionItemKind, InsertTextFormat, Range, TextEdit, type Connection, type DocumentFormattingParams, type TextDocumentChangeEvent } from "vscode-languageserver"
import { z } from "zod"
import { LanguageServer, type CompletionFiles, type TextDocumentRequestParams } from "../LanguageServer"
import { EventType, HUDAnimationsTextDocument, type HUDAnimationsTextDocumentDependencies } from "./HUDAnimationsTextDocument"
import { HUDAnimationsWorkspace } from "./HUDAnimationsWorkspace"
import eventFiles from "./eventFiles.json"

export class HUDAnimationsLanguageServer extends LanguageServer<"hudanimations", HUDAnimationsTextDocument, HUDAnimationsDocumentSymbols, HUDAnimationsTextDocumentDependencies> {

	public static readonly keywords = <const>[
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

	private readonly workspaces: Map<string, Promise<HUDAnimationsWorkspace>>

	constructor(languageId: "hudanimations", name: "HUD Animations", connection: Connection, platform: string) {
		super(languageId, name, connection, {
			platform: platform,
			servers: new Set(["vdf"]),
			capabilities: {},
			createDocument: async (init, documentConfiguration$) => {
				const hudRoot = await this.trpc.client.searchForHUDRoot.query({ uri: init.uri })

				const fileSystem = await this.fileSystems.get([
					...(hudRoot ? [{ type: <const>"folder", uri: hudRoot }] : []),
					{ type: "tf2" },
				])

				let workspace: Promise<HUDAnimationsWorkspace> | null

				if (hudRoot != null) {
					const key = hudRoot.toString()
					let w = this.workspaces.get(key)
					if (!w) {
						w = Promise.resolve(new HUDAnimationsWorkspace({
							uri: hudRoot,
							fileSystem: fileSystem,
							documents: this.documents,
							request: this.trpc.servers.vgui.workspace.open.mutate({ uri: hudRoot }),
							getVDFDocumentSymbols: (path) => new Observable<VDFDocumentSymbols | null>((subscriber) => {
								return this.trpc.servers.vgui.workspace.documentSymbol.subscribe({ key: hudRoot, path }, {
									onData: (value) => subscriber.next(value),
									onError: (err) => subscriber.error(err),
									onComplete: () => subscriber.complete(),
								})
							}),
							getDefinitions: (path) => new Observable((subscriber) => {
								return this.trpc.servers.vgui.workspace.definitions.subscribe({ key: hudRoot, path: path }, {
									onData: (value) => subscriber.next(value),
									onError: (err) => subscriber.error(err),
									onComplete: () => subscriber.complete(),
								})
							}),
							setFileReferences: async (references) => await this.trpc.servers.vgui.workspace.setFilesReferences.mutate({ key: hudRoot, references: references })
						}))
						this.workspaces.set(key, w)
					}
					workspace = w
				}
				else {
					workspace = null
				}

				return new HUDAnimationsTextDocument(
					init,
					documentConfiguration$,
					fileSystem,
					await workspace,
				)
			}
		})

		this.workspaces = new Map()
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({
				workspace: {
					open: t
						.procedure
						.input(
							z.object({
								uri: Uri.schema,
							})
						)
						.mutation(async ({ input }) => {
							if (!this.workspaces.has(input.uri.toString())) {
								this.workspaces.set(
									input.uri.toString(),
									Promise.try(async () => new HUDAnimationsWorkspace({
										uri: input.uri,
										fileSystem: await this.fileSystems.get([
											{ type: "folder", uri: input.uri },
											{ type: "tf2" }
										]),
										documents: this.documents,
										request: Promise.resolve(),
										getVDFDocumentSymbols: (path) => new Observable<VDFDocumentSymbols | null>((subscriber) => {
											return this.trpc.servers.vgui.workspace.documentSymbol.subscribe({ key: input.uri, path: path }, {
												onData: (value) => subscriber.next(value),
												onError: (err) => subscriber.error(err),
												onComplete: () => subscriber.complete(),
											})
										}),
										getDefinitions: (path) => new Observable((subscriber) => {
											return this.trpc.servers.vgui.workspace.definitions.subscribe({ key: input.uri, path: path }, {
												onData: (value) => subscriber.next(value),
												onError: (err) => subscriber.error(err),
												onComplete: () => subscriber.complete(),
											})
										}),
										setFileReferences: async (references) => await this.trpc.servers.vgui.workspace.setFilesReferences.mutate({ key: input.uri, references: references })
									}))
								)
							}
						})
				}
			})
		)
	}

	protected async onDidOpen(event: TextDocumentChangeEvent<HUDAnimationsTextDocument>): Promise<AsyncDisposable> {

		const stack = new AsyncDisposableStack()
		stack.use(await super.onDidOpen(event))

		const key = await this.trpc.client.window.createTextEditorDecorationType.mutate({
			options: {
				after: {
					margin: "0 0 0 0.5rem",
					color: "#99999959",
				}
			}
		})

		const subscriptions: Subscription[] = []
		stack.defer(() => {
			for (const subscription of subscriptions) {
				subscription.unsubscribe()
			}
		})

		const workspace = event.document.workspace

		if (workspace) {
			subscriptions.push(
				event.document.definitionReferences$.subscribe(async (documentDefinitionReferences) => {
					await this.trpc.servers.vgui.workspace.setFilesReferences.mutate({
						key: workspace.uri,
						references: HUDAnimationsWorkspace.extractWorkspaceReferences(event.document.uri, documentDefinitionReferences.references)
					})
				})
			)
		}

		subscriptions.push(
			event.document.decorations$.subscribe((decorations) => {
				this.trpc.client.textDocument.decoration.mutate({
					uri: event.document.uri,
					key: key,
					decorations: decorations
				})
			})
		)

		return stack.move()
	}

	protected async getCompletion(document: HUDAnimationsTextDocument, position: VDFPosition, files: CompletionFiles, conditionals: (text?: string) => CompletionItem[]): Promise<CompletionItem[] | null> {

		const documentSymbols = await firstValueFrom(document.documentSymbols$)

		const eventDocumentSymbol = documentSymbols.find((documentSymbol) => documentSymbol.range.contains(position))

		const line = document.getText({ start: { line: position.line, character: 0 }, end: position })

		if (!eventDocumentSymbol && !line.includes("event")) {
			return [{
				label: "event",
				kind: CompletionItemKind.Keyword,
				preselect: true,
				insertText: "event $1\n{\n\t$0\n}",
				insertTextFormat: InsertTextFormat.Snippet
			}]
		}

		const tokens = Array.from(generateTokens(line))

		if (tokens.length == 0) {
			return keywords()
		}
		else if (tokens.length == 1 && line.endsWith(tokens[0])) {
			return keywords(tokens[0])
		}

		switch (tokens[0].toLowerCase()) {
			case "event": {
				switch (tokens.length) {
					case 2:
						return line.endsWith(tokens[1])
							? null
							: conditionals()
					case 3:
						return line.endsWith(tokens[2])
							? conditionals(tokens[2])
							: null
					default:
						return null
				}
			}
			case "animate": {
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: properties()
					case 3:
						return line.endsWith(tokens[2])
							? properties(tokens[2])
							: HUDAnimationsTextDocument.colourProperties.has(tokens[2].toLowerCase())
								? colours()
								: null
					case 4:
						return line.endsWith(tokens[3])
							? colours(tokens[3])
							: interpolators()
					case 5:
						return line.endsWith(tokens[4])
							? interpolators(tokens[4])
							: null /* delay */
					case 6:
						return line.endsWith(tokens[5])
							? null /* delay */
							: null /* duration */
					case 7:
						return line.endsWith(tokens[6])
							? null /* duration */
							: conditionals()
					case 8:
						return line.endsWith(tokens[7])
							? conditionals(tokens[7])
							: null
					default:
						return null
				}
			}
			case "runevent":
			case "stopevent": {
				switch (tokens.length) {
					case 1:
						return events()
					case 2:
						return line.endsWith(tokens[1])
							? events(tokens[1])
							: null /* delay */
					case 3:
						return line.endsWith(tokens[2])
							? null /* delay */
							: conditionals()
					case 4:
						return line.endsWith(tokens[3])
							? conditionals(tokens[3])
							: null
					default:
						return null
				}
			}
			case "setvisible":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: [{ label: "0", kind: CompletionItemKind.Enum }, { label: "1", kind: CompletionItemKind.Enum }] /* visible */
					case 3:
						return line.endsWith(tokens[2])
							? [{ label: "0", kind: CompletionItemKind.Enum }, { label: "1", kind: CompletionItemKind.Enum }] /* visible */
							: null /* delay */
					case 4:
						return line.endsWith(tokens[3])
							? null /* delay */
							: conditionals()
					case 5:
						return line.endsWith(tokens[4])
							? conditionals(tokens[4])
							: null
					default:
						return null
				}
			case "runeventchild":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: events()
					case 3:
						return line.endsWith(tokens[2])
							? events(tokens[2])
							: null /* delay */
					case 4:
						return line.endsWith(tokens[3])
							? null /* delay */
							: conditionals()
					case 5:
						return line.endsWith(tokens[4])
							? conditionals(tokens[4])
							: null
					default:
						return null
				}
			case "setinputenabled":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: [{ label: "0", kind: CompletionItemKind.Enum }, { label: "1", kind: CompletionItemKind.Enum }] /* enabled */
					case 3:
						return line.endsWith(tokens[2])
							? [{ label: "0", kind: CompletionItemKind.Enum }, { label: "1", kind: CompletionItemKind.Enum }] /* enabled */
							: null /* delay */
					case 4:
						return line.endsWith(tokens[3])
							? null /* delay */
							: conditionals()
					case 5:
						return line.endsWith(tokens[4])
							? conditionals(tokens[4])
							: null
					default:
						return null
				}
			case "playsound":
				switch (tokens.length) {
					case 1:
						return null /* delay */
					case 2:
						return line.endsWith(tokens[1])
							? null /* delay */
							: sounds()
					case 3:
						return line.endsWith(tokens[2])
							? sounds(tokens[2])
							: conditionals()
					case 4:
						return line.endsWith(tokens[3])
							? conditionals(tokens[3])
							: null
					default:
						return null
				}
			case "stoppanelanimations":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: null /* delay */
					case 3:
						return line.endsWith(tokens[2])
							? null /* delay */
							: conditionals()
					case 4:
						return line.endsWith(tokens[3])
							? conditionals(tokens[3])
							: null
					default:
						return null
				}
			case "setfont":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: fontProperties()
					case 3:
						return line.endsWith(tokens[2])
							? fontProperties(tokens[2])
							: fonts()
					case 4:
						return line.endsWith(tokens[3])
							? fonts(tokens[3])
							: null /* delay */
					case 5:
						return line.endsWith(tokens[4])
							? null /* delay */
							: conditionals()
					case 6:
						return line.endsWith(tokens[5])
							? conditionals(tokens[5])
							: null
					default:
						return null
				}
			case "settexture":
			case "setstring":
				switch (tokens.length) {
					case 1:
						return elements()
					case 2:
						return line.endsWith(tokens[1])
							? elements(tokens[1])
							: null /* property */
					case 3:
						return line.endsWith(tokens[2])
							? null /* property */
							: null /* value */
					case 4:
						return line.endsWith(tokens[3])
							? null /* value */
							: null /* delay */
					case 5:
						return line.endsWith(tokens[4])
							? null /* delay */
							: conditionals()
					case 6:
						return line.endsWith(tokens[5])
							? conditionals(tokens[5])
							: null
					default:
						return null
				}
		}

		function filter(text?: string): (str: string) => boolean {
			text = text?.toLowerCase()
			return text != undefined
				? (str: string) => str.toLowerCase().startsWith(text)
				: () => true
		}

		function keywords(text?: string) {
			return HUDAnimationsLanguageServer
				.keywords
				.values()
				.filter(filter(text))
				.map((str) => ({ label: str, kind: CompletionItemKind.Keyword }))
				.toArray()
		}

		async function elements(text?: string) {
			if (!document.workspace || !eventDocumentSymbol) {
				return null
			}

			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			const definitions = definitionReferences.definitions.ofType(null, Symbol.for(eventDocumentSymbol.eventName.toLowerCase()))

			return [
				...new Set(
					definitions
						.values()
						.flatMap((definitions) => definitions)
						.map((definition) => definition.key)
						.filter(filter(text))
				)
			].map((key) => ({
				label: key,
				kind: CompletionItemKind.Variable
			}))
		}

		function properties(text?: string) {
			return HUDAnimationsLanguageServer
				.properties
				.values()
				.filter(filter(text))
				.map((key) => ({
					label: key,
					kind: CompletionItemKind.Keyword
				}))
				.toArray()
		}

		function fontProperties(text?: string) {
			return HUDAnimationsTextDocument
				.fontProperties
				.values()
				.filter(filter(text))
				.map((key) => ({
					label: key,
					kind: CompletionItemKind.Keyword
				}))
				.toArray()
		}

		async function colours(text?: string) {
			if (!document.workspace) {
				return null
			}

			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			const definitions = definitionReferences.definitions.ofType(null, Symbol.for("color"))

			const f = filter(text)

			return definitions
				.values()
				.map((definitions) => definitions[0])
				.filter((definition): definition is typeof definition & { detail: string } => definition != undefined && f(definition.key) && definition.detail != undefined)
				.map((definition) => {
					return {
						label: definition.key,
						kind: CompletionItemKind.Color,
						// documentation: definition.documentation
					} satisfies CompletionItem
				}).toArray()
		}

		async function fonts(text?: string) {
			if (!document.workspace) {
				return null
			}

			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			const definitions = definitionReferences.definitions.ofType(null, Symbol.for("font"))

			return definitions
				.values()
				.flatMap((definitions) => definitions)
				.map((definition) => definition.key)
				.filter(filter(text))
				.map((key) => ({
					label: key,
					kind: CompletionItemKind.Text
				})).toArray()
		}

		function interpolators(text?: string) {
			return HUDAnimationsLanguageServer
				.interpolators
				.values()
				.filter(filter(text))
				.map((key) => ({
					label: key,
					kind: CompletionItemKind.Keyword
				}))
				.toArray()
		}

		async function events(text?: string) {
			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			const definitions = definitionReferences.definitions.ofType(null, EventType)

			return [
				...new Set(
					definitions
						.values()
						.flatMap((definitions) => definitions)
						.map((definition) => definition.key)
						.filter(filter(text))
				)
			].map((key) => ({
				label: key,
				kind: CompletionItemKind.Event
			}))
		}

		function sounds(text?: string) {
			return files("sound", { value: text ?? null, extensionsPattern: null })
		}

		return []
	}

	protected async onDocumentFormatting(document: HUDAnimationsTextDocument, params: TextDocumentRequestParams<DocumentFormattingParams>): Promise<TextEdit[]> {

		const documentFormattingConfiguration = (await firstValueFrom(document.documentConfiguration$))[this.languageId].format

		const options: HUDAnimationsFormatStringifyOptions = {
			layoutScope: documentFormattingConfiguration.layoutScope,
			tabs: documentFormattingConfiguration.tabs,
			breakAfterEvent: documentFormattingConfiguration.insertNewlineAfterEvents,
			insertFinalNewline: params.options.insertFinalNewline ?? false,
		}

		const MAX_VALUE = ((2 ** 31) - 1)

		return [
			{
				range: Range.create(0, 0, MAX_VALUE, MAX_VALUE),
				newText: formatHUDAnimations(document.getText(), options),
			}
		]
	}

	protected async rename(document: HUDAnimationsTextDocument, scope: number | null, type: symbol, key: string, newName: string): Promise<Record<string, TextEdit[]>> {

		const definitionReferences = await firstValueFrom(document.definitionReferences$)
		const changes: Record<string, TextEdit[]> = {}

		// Wait for HUD Animations element references to be sent to VGUI Language Server before requesting rename,
		// or HUD Animations references will not be included in the rename
		await document.workspace?.ready

		if (type == EventType) {
			for (const definition of definitionReferences.definitions.get(scope, type, key) ?? []) {
				(changes[definition.uri.toString()] ??= []).push(TextEdit.replace(definition.keyRange, newName))
			}

			for (const { uri, range } of definitionReferences.references.collect(scope, type, key)) {
				(changes[uri.toString()] ??= []).push(TextEdit.replace(range, newName))
			}
		}
		else {
			const eventName = Symbol.keyFor(type)
			if (eventName != undefined && eventName in eventFiles) {
				const uris: Uri[] = []
				for (const uri of definitionReferences.definitions.get(scope, type, key)?.flatMap(({ uri }) => uri) ?? []) {
					if (!uris.some((u) => u.equals(uri))) {
						uris.push(uri)
					}
				}

				await Promise.all(
					uris.map((uri) =>
						this.trpc.servers.vgui.textDocument.rename.query({
							textDocument: { uri: uri },
							oldName: { scope: scope, type: Symbol.for("element"), key: key },
							newName: newName
						}).then((result) => {
							for (const uri in result) {
								(changes[uri] ??= []).push(...result[uri])
							}
						})
					)
				)
			}
		}

		if ((type == Symbol.for("color") || type == Symbol.for("font")) && document.workspace != null) {
			return await this.trpc.servers.vgui.textDocument.rename.query({
				textDocument: { uri: document.workspace.uri.joinPath("resource/clientscheme.res") },
				oldName: { scope: scope, type: type, key: key },
				newName: newName
			})
		}

		return changes
	}
}
