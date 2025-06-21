import type { VSCodeVDFLanguageID } from "common/VSCodeVDFLanguageID"
import { commands, CompletionList, DocumentSymbol, EventEmitter, Hover, Position, SignatureHelp, Uri, workspace, type ExtensionContext, type TextDocument } from "vscode"
import type { Middleware } from "vscode-languageclient"

function createEmbeddedLanguageMiddleware(
	context: ExtensionContext,
	languageId: string,
	extension: `.${string}`,
	getVirtualContent: (document: TextDocument, documentSymbols: DocumentSymbol[], position: Position) => string | null
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

	async function middleware<T>({ document, position, next, embedded }: { document: TextDocument, position: Position, next: () => Promise<T>, embedded: (uri: Uri) => Promise<T> }) {
		const content = getVirtualContent(document, await commands.executeCommand<DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", document.uri), position)
		if (!content) {
			return await next()
		}

		const uri = Uri.from({ scheme: `embedded-${languageId}`, path: `${document.uri.path}${extension}` })
		const key = uri.toString()

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
		popfile: createEmbeddedLanguageMiddleware(context, "squirrel", ".nut", (document, documentSymbols, position) => {
			function walk(documentSymbols: DocumentSymbol[]): DocumentSymbol | null {
				for (const documentSymbol of documentSymbols) {
					if (documentSymbol.range.contains(position)) {
						if (documentSymbol.children.length != 0) {
							return walk(documentSymbol.children)
						}
						else if (documentSymbol.name.toLowerCase() == "Param".toLowerCase()) {
							return documentSymbol
						}
					}
				}
				return null
			}

			const documentSymbol = walk(documentSymbols)
			if (!documentSymbol) {
				return null
			}

			let content = document.getText()
				.split("\n")
				.map((line) => " ".repeat(line.length))
				.join("\n")

			const range = documentSymbol.range

			return ""
				+ content.slice(0, document.offsetAt(range.start))
				+ document.getText(range)
					.replace(/^.*?"/i, (str) => " ".repeat(str.length))
					.replace(/"$/, (str) => " ".repeat(str.length))
					.replace("`", "\"")
				+ content.slice(document.offsetAt(range.end))
		})
	}
}
