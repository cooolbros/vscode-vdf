import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { getVDFDocumentSymbols } from "vdf-documentsymbols/getVDFDocumentSymbols"
import { commands, CompletionList, EventEmitter, Hover, Position, Range, SignatureHelp, Uri, workspace, type ExtensionContext, type TextDocument } from "vscode"
import type { Middleware } from "vscode-languageclient"

function createEmbeddedLanguageMiddleware(
	context: ExtensionContext,
	languageId: string,
	extension: `.${string}`,
	getVirtualRanges: (text: string) => Range[]
): Middleware {
	const documentContents = new Map<string, string>()
	const eventEmitter = new EventEmitter<Uri>()

	context.subscriptions.push(
		eventEmitter,
		workspace.registerTextDocumentContentProvider(`embedded-${languageId}`, {
			onDidChange: eventEmitter.event,
			provideTextDocumentContent: (uri, token) => {
				return documentContents.get(uri.toString())
			}
		})
	)

	const clear = (text: string) => text.split("\n").map((line) => " ".repeat(line.length)).join("\n")

	async function middleware<T>({ document, position, next, embedded }: { document: TextDocument, position: Position, next: () => Promise<T>, embedded: (uri: Uri) => Promise<T> }) {
		const text = document.getText()
		const ranges = getVirtualRanges(text)
		if (!ranges.length || !ranges.some((range) => range.contains(position))) {
			return await next()
		}

		const uri = Uri.from({ scheme: `embedded-${languageId}`, path: `${document.uri.path}${extension}` })
		const key = uri.toString()

		let content = clear(text.slice(0, document.offsetAt(ranges[0].start)))
		for (const [index, range] of ranges.entries()) {
			content += document.getText(range)

			const end = ranges[index + 1] != undefined
				? ranges[index + 1].start
				: undefined

			content += clear(text.slice(document.offsetAt(range.end), end && document.offsetAt(end)))
		}

		if (documentContents.has(key)) {
			documentContents.set(key, content)
			eventEmitter.fire(uri)
		}
		else {
			documentContents.set(key, content)
		}

		return await embedded(uri)
	}

	return {
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

				const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.name.toLowerCase() != "#base")?.children
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

					const range = param.detailRange
					return [new Range(new Position(range.start.line, range.start.character), new Position(range.end.line, range.end.character))]
				}

				function collect(documentSymbol: VDFDocumentSymbol): Range[] {
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
			}
		)
	}
}
