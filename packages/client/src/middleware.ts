import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { commands, CompletionList, EventEmitter, Hover, Position, SignatureHelp, Uri, workspace, type ExtensionContext, type TextDocument } from "vscode"
import type { Middleware } from "vscode-languageclient"
import { VSCodeDocumentGetTextSchema, VSCodePositionSchema } from "./VSCodeSchemas"

function createEmbeddedLanguageMiddleware(
	context: ExtensionContext,
	languageId: string,
	extension: `.${string}`,
	getVirtualRanges: (text: string) => VDFRange[],
	translate: (text: string) => string
): Middleware {
	const documents = new Map<string, { version: number, text: string, ranges: VDFRange[] }>()
	const virtualDocumentContents = new Map<string, { version: number, content: string }>()
	const eventEmitter = new EventEmitter<Uri>()

	context.subscriptions.push(
		eventEmitter,
		workspace.registerTextDocumentContentProvider(`embedded-${languageId}`, {
			onDidChange: eventEmitter.event,
			provideTextDocumentContent: (uri, token) => virtualDocumentContents.get(uri.toString())?.content
		})
	)

	const virtual = (uri: Uri) => Uri.from({ scheme: `embedded-${languageId}`, path: `${uri.path}${extension}` })
	const clear = (text: string) => text.split("\n").map((line) => " ".repeat(line.length)).join("\n")

	async function middleware<T>({ document, position, next, embedded }: { document: TextDocument, position: Position, next: () => Promise<T>, embedded: (uri: Uri) => Promise<T> }) {
		let value = documents.get(document.uri.toString())
		if (value?.version != document.version) {
			const text = document.getText()
			try {
				value = { version: document.version, text: text, ranges: getVirtualRanges(text) }
			}
			catch (error) {
				value ??= { version: document.version, text: text, ranges: [] }
			}
			documents.set(document.uri.toString(), value)
		}

		const { text, ranges } = value
		if (!ranges.length || !ranges.some((range) => range.contains(position))) {
			return await next()
		}

		const uri = virtual(document.uri)
		if (virtualDocumentContents.get(uri.toString())?.version != document.version) {
			let content = clear(text.slice(0, document.offsetAt(VSCodePositionSchema.parse(ranges[0].start))))
			for (const [index, range] of ranges.entries()) {
				content += translate(document.getText(VSCodeDocumentGetTextSchema.parse(range)))
				const end = ranges[index + 1]?.start
				content += clear(text.slice(document.offsetAt(VSCodePositionSchema.parse(range.end)), end && document.offsetAt(VSCodePositionSchema.parse(end))))
			}

			virtualDocumentContents.set(uri.toString(), { version: document.version, content: content })
			eventEmitter.fire(uri)
		}

		return await embedded(uri)
	}

	return {
		didClose: async (document, next) => {
			documents.delete(document.uri.toString())
			virtualDocumentContents.delete(virtual(document.uri).toString())
			return await next(document)
		},
		provideCompletionItem: async (document, position, context, token, next) => {
			return await middleware({
				document,
				position,
				next: async () => await next(document, position, context, token),
				embedded: async (uri) => await commands.executeCommand<CompletionList>(
					"vscode.executeCompletionItemProvider",
					uri,
					position,
					context.triggerCharacter,
				)
			})
		},
		provideHover: async (document, position, token, next) => {
			return await middleware({
				document,
				position,
				next: async () => await next(document, position, token),
				embedded: async (uri) => await commands.executeCommand<Hover[]>(
					"vscode.executeHoverProvider",
					uri,
					position,
				).then((hovers) => hovers[0])
			})
		},
		provideSignatureHelp: async (document, position, context, token, next) => {
			return await middleware({
				document,
				position,
				next: async () => await next(document, position, context, token),
				embedded: async (uri) => await commands.executeCommand<SignatureHelp>(
					"vscode.executeSignatureHelpProvider",
					uri,
					position,
					context.triggerCharacter
				)
			})
		}
	}
}

export function createMiddleware(context: ExtensionContext): Partial<Record<VSCodeVDFLanguageID, Middleware>> {
	return {
		popfile: createEmbeddedLanguageMiddleware(
			context,
			"squirrel",
			".nut",
			(text) => {
				const documentSymbols = getVDFDocumentSymbols(text, { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) })
				if (!documentSymbols) {
					return []
				}

				const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() != "#base")?.children
				if (!waveSchedule) {
					return []
				}

				const waveEvents = new Set([
					"DoneOutput".toLowerCase(),
					"InitWaveOutput".toLowerCase(),
					"StartWaveOutput".toLowerCase(),
				])

				function event(documentSymbol: VDFDocumentSymbol) {
					if (!documentSymbol.children) {
						return []
					}

					const action = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Action".toLowerCase())?.detail?.toLowerCase()
					if (action != "RunScriptCode".toLowerCase()) {
						return []
					}

					const param = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Param".toLowerCase())
					if (!param?.detailRange) {
						return []
					}

					return [param.detailRange]
				}

				function collect(documentSymbol: VDFDocumentSymbol): VDFRange[] {
					if (!documentSymbol.children) {
						return []
					}

					switch (documentSymbol.key.toLowerCase()) {
						case "Mob".toLowerCase():
						case "RandomChoice".toLowerCase():
						case "SentryGun".toLowerCase():
						case "Squad".toLowerCase():
							return documentSymbol
								.children
								.flatMap(collect)
						case "Tank".toLowerCase():
							return documentSymbol
								.children
								.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "OnBombDroppedOutput".toLowerCase() || documentSymbol.key.toLowerCase() == "OnKilledOutput".toLowerCase())
								.flatMap(event)
						default:
							return []
					}
				}

				return [
					...waveSchedule
						.values()
						.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Mission".toLowerCase())
						.flatMap((documentSymbol) => documentSymbol.children?.flatMap(collect) ?? []),
					...waveSchedule
						.values()
						.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase())
						.flatMap((documentSymbol) => {
							if (!documentSymbol.children) {
								return []
							}

							return documentSymbol
								.children
								.values()
								.flatMap((documentSymbol) => {
									const key = documentSymbol.key.toLowerCase()
									if (key == "WaveSpawn".toLowerCase()) {
										return documentSymbol.children?.flatMap(collect) ?? []
									}
									else if (waveEvents.has(key)) {
										return event(documentSymbol)
									}
									else {
										return []
									}
								})
						})
				]
			},
			(text) => text.replaceAll("`", "\"")
		)
	}
}
