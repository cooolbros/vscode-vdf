import { createTRPCClient, type TRPCClient } from "@trpc/client"
import type { ClientRouter } from "client/TRPCClientRouter"
import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import { devalueTransformer } from "common/devalueTransformer"
import type { FileSystemKey } from "common/FileSystemKey"
import { type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { GameInfo } from "common/GameInfo"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { VSCodeJSONRPCLink } from "common/VSCodeJSONRPCLink"
import { VSCodeVDFConfigurationSchema } from "common/VSCodeVDFConfiguration"
import { VSCodeVDFLanguageIDSchema } from "common/VSCodeVDFLanguageID"
import { Minimatch } from "minimatch"
import { BehaviorSubject, buffer, combineLatest, concatMap, defer, distinctUntilChanged, distinctUntilKeyChanged, EMPTY, finalize, firstValueFrom, shareReplay, skip, Subject, switchMap, type Observable } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import type vscode from "vscode"
import { CodeActionKind, CodeLensRefreshRequest, DidChangeConfigurationNotification, InlayHintRequest, Range, TextDocumentSyncKind, TextEdit, type CodeAction, type Connection, type Diagnostic, type DocumentSymbol, type InlayHint, type InlayHintParams } from "vscode-languageserver"
import { z } from "zod"
import { contributes, version } from "../../../package.json"
import { HUDAnimationsTextDocument } from "./HUDAnimations/HUDAnimationsTextDocument"
import { PopfileTextDocument } from "./Popfile/PopfileTextDocument"
import type { DiagnosticCodeAction, DiagnosticFix, TextDocumentInit } from "./TextDocumentBase"
import { VDFTextDocument } from "./VDF/VDFTextDocument"
import { VDFWorkspace } from "./VDFWorkspace"
import { VMTTextDocument } from "./VMT/VMTTextDocument"

export type TextDocument = (
	| HUDAnimationsTextDocument
	| PopfileTextDocument
	| VDFTextDocument
	| VMTTextDocument
)

export class VDFLanguageServer extends AsyncDisposableBase {

	private readonly trpc: TRPCClient<ClientRouter>
	private readonly fileSystems: RefCountAsyncDisposableFactory<FileSystemKey[], FileSystemMountPoint>
	private readonly workspaces: { get: (uri: Uri) => Promise<VDFWorkspace> }
	private readonly documents: RefCountAsyncDisposableFactory<Uri, TextDocument>

	private readonly diagnostic = { id: 0 }
	private readonly documentsDiagnostics: Map<string, Map<number, DiagnosticCodeAction>>

	constructor(connection: Connection, platform: string) {
		super()

		// "Restart VDF Language Server"
		connection.onExit(async () => await this[Symbol.asyncDispose]())

		const onInitializePromise = Promise.withResolvers<{ teamFortress2Folder: Uri, workspaceUris: Uri[] }>()
		const onDidChangeConfiguration$ = new BehaviorSubject<void>(undefined)
		const gameInfo$ = defer(async () => {
			const { teamFortress2Folder } = await onInitializePromise.promise
			const text = await this.trpc.vscode.workspace.fs.readFile.query({ uri: teamFortress2Folder.joinPath("tf/gameinfo.txt"), encoding: "utf-8" })
			return new GameInfo(teamFortress2Folder, text)
		}).pipe(
			shareReplay(1)
		)

		this.trpc = createTRPCClient<ClientRouter>({
			links: [
				VSCodeJSONRPCLink({
					stack: this.stack,
					client: { name: "vdf" },
					transformer: devalueTransformer({
						reducers: {
							Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
							VDFRange: (value: unknown) => value instanceof VDFRange ? value.toJSON() : undefined,
						},
						revivers: {
							Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
							VDFPosition: (value: ReturnType<VDFPosition["toJSON"]>) => VDFPosition.schema.parse(value),
							VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
						}
					}),
					onNotification: (type, handler) => {
						const disposable = connection.onNotification(type, handler)
						return { [Symbol.dispose]: () => disposable.dispose() }
					},
					sendRequest: async (method, param) => await connection.sendRequest(method, param)
				})
			]
		})

		this.fileSystems = new RefCountAsyncDisposableFactory(
			(paths) => JSON.stringify(paths),
			async (paths, factory) => {
				const { key } = await this.trpc.teamFortress2FileSystem.open.mutate({ paths })
				const files = new Map<string, Observable<Entry>>()
				const directories = new Map<string, Observable<[string, vscode.FileType][]>>()
				return {
					resolve: (path) => {
						return files.getOrInsertComputed(path, () => {
							return fromTRPCSubscription(this.trpc.teamFortress2FileSystem.resolve, { key, path }).pipe(
								distinctUntilChanged((a, b) => a.type == b.type && Uri.equals(a.uri, b.uri)),
								finalize(() => files.delete(path)),
								shareReplay({ bufferSize: 1, refCount: true })
							)
						})
					},
					readDirectory: async (path, options) => {
						return await this.trpc.teamFortress2FileSystem.readDirectory.query({ key, path, options })
					},
					watchDirectory: (path, options) => {
						const directoryKey = JSON.stringify({ path, options })
						return directories.getOrInsertComputed(directoryKey, () => {
							return fromTRPCSubscription(this.trpc.teamFortress2FileSystem.watchDirectory, { key, path, options }).pipe(
								finalize(() => directories.delete(directoryKey)),
								shareReplay({ bufferSize: 1, refCount: true })
							)
						})
					},
					[Symbol.asyncDispose]: async () => {
						await this.trpc.teamFortress2FileSystem.dispose.mutate({ key })
					}
				}
			}
		)

		const workspaces = new Map<string, Promise<VDFWorkspace>>()
		this.stack.defer(async () => {
			await Promise.all(workspaces.values().map(async (promise) => (await promise)[Symbol.asyncDispose]()))
		})

		this.workspaces = {
			get: async (uri) => {
				return await workspaces.getOrInsertComputed(
					uri.toString(),
					async () => {
						const { teamFortress2Folder, workspaceUris } = await onInitializePromise.promise
						const fileSystem = await this.fileSystems.get([
							...(!Uri.equals(uri, teamFortress2Folder) ? [{ type: <const>"folder", folder: uri }] : []),
							{ type: "tf2", teamFortress2Folder: teamFortress2Folder },
							...workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
						])

						return new VDFWorkspace({
							uri: !Uri.equals(uri, teamFortress2Folder) ? uri : uri.joinPath("tf"),
							connection: connection,
							fileSystem: fileSystem,
							fileSystems: this.fileSystems,
							documents: this.documents,
							teamFortress2Folder,
							workspaceUris,
							trpc: this.trpc,
						})
					}
				)
			}
		}

		const languages = Array.from(contributes.languages).map((language) => {
			const filenames = new Set(language.filenames?.map((filename) => filename.toLowerCase()) ?? [])
			const filenamePatterns = (language.filenamePatterns ?? []).map((filenamePattern) => new Minimatch(filenamePattern))
			const extensions = new Set(language.extensions.map((extension) => extension.toLowerCase()))
			return {
				language: VSCodeVDFLanguageIDSchema.parse(language.id),
				match: (uri: Uri) => {
					const basename = uri.basename()
					const extname = uri.extname()
					return filenames.has(basename.toLowerCase())
						|| filenamePatterns.some((filenamePattern) => filenamePattern.match(basename))
						|| extensions.has(extname)
				}
			}
		})

		const createDocumentInit = (uri: Uri) => {
			const query = new URLSearchParams(uri.query)

			const encodingParam = query.get("encoding")
			const encoding = encodingParam != null ? z.enum(["utf-8", "utf-16le"]).parse(encodingParam) : undefined

			const languageParam = query.get("language")
			const language = languageParam != null ? VSCodeVDFLanguageIDSchema.parse(languageParam) : languages.find((language) => language.match(uri))?.language

			query.delete("encoding")
			query.delete("language")
			query.sort()

			return {
				uri: uri.with({ query: query.toString() }),
				encoding: encoding,
				language: language,
			}
		}

		const createDocument = async (init: TextDocumentInit): Promise<TextDocument> => {
			const { hudRoot, onInitialize: { teamFortress2Folder, workspaceUris } } = await firstValueFrom(combineLatest({
				hudRoot: this.trpc.searchForHUDRoot.query({ uri: init.uri }),
				onInitialize: onInitializePromise.promise
			}))

			const workspace = await (
				!teamFortress2Folder.relative(init.uri).startsWith("..")
					? this.workspaces.get(teamFortress2Folder)
					: hudRoot != null
						? this.workspaces.get(hudRoot)
						: this.workspaces.get(teamFortress2Folder)
			)

			const path = await Promise.try(async () => {
				switch (init.uri.scheme) {
					case "bsp":
					case "vpk":
					case "vscode-vdf-tf-remote-resource":
						return init.uri.path.substring(1)
					case "untitled":
						return null
					default:
						if (init.uri.scheme == teamFortress2Folder.scheme && !teamFortress2Folder.relative(init.uri).startsWith("..")) {
							return (await firstValueFrom(gameInfo$)).relative(init.uri)
						}
						else if (hudRoot != null) {
							return hudRoot.relative(init.uri)
						}
						else {
							const workspaceRelativePath = workspaceUris
								.values()
								.filter((workspaceUri) => workspaceUri.scheme == init.uri.scheme)
								.map((workspaceUri) => workspaceUri.relative(init.uri))
								.find((path) => !path.startsWith(".."))

							if (workspaceRelativePath != undefined) {
								return workspaceRelativePath
							}

							if (init.languageId == "popfile") {
								return `scripts/population/${init.uri.basename()}`
							}
							else {
								// https://github.com/microsoft/vscode/blob/main/src/vs/base/common/network.ts
								// console.warn(`Unknown Uri.scheme: ${init.uri}`)
								return null
							}
						}
				}
			})

			const documentConfiguration$ = onDidChangeConfiguration$.pipe(
				concatMap(async () => VSCodeVDFConfigurationSchema.parse(await connection.workspace.getConfiguration({ scopeUri: init.uri.toString(), section: "vscode-vdf" }))),
				shareReplay({ bufferSize: 1, refCount: true })
			)

			switch (init.languageId) {
				case "hudanimations": {
					const fileSystem = await this.fileSystems.get([
						...(hudRoot != null ? [{ type: <const>"folder", folder: hudRoot }] : []),
						{ type: "tf2", teamFortress2Folder: teamFortress2Folder },
						...workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
					])
					return new HUDAnimationsTextDocument(init, documentConfiguration$, fileSystem, this.documents, this.trpc, workspace, path)
				}
				case "popfile": {
					const fileSystem = await this.fileSystems.get([
						{ type: "popfile:bsp", teamFortress2Folder: teamFortress2Folder, popfile: init.uri },
						{ type: "tf2", teamFortress2Folder: teamFortress2Folder },
						...workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
					])
					return new PopfileTextDocument(init, documentConfiguration$, fileSystem, this.documents, this.trpc, workspace, path)
				}
				case "vdf": {
					const fileSystem = await this.fileSystems.get([
						...(hudRoot != null ? [{ type: <const>"folder", folder: hudRoot }] : []),
						{ type: "tf2", teamFortress2Folder: teamFortress2Folder },
						...workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
					])
					return new VDFTextDocument(init, documentConfiguration$, fileSystem, this.documents, this.trpc, workspace, path)
				}
				case "vmt": {
					const fileSystem = await this.fileSystems.get([
						...(init.uri.scheme == "bsp" ? [{ type: <const>"bsp", bsp: new Uri(JSON.parse(new URLSearchParams(init.uri.query).get("root")!)) }] : []),
						...(hudRoot != null ? [{ type: <const>"folder", folder: hudRoot }] : []),
						{ type: "tf2", teamFortress2Folder: teamFortress2Folder },
						...workspaceUris.map((uri) => ({ type: <const>"folder", folder: uri })),
					])
					return new VMTTextDocument(init, documentConfiguration$, fileSystem, this.documents, this.trpc, workspace, path)
				}
				default: {
					throw new Error(`Invalid language: ${init.languageId} ${init.uri}`)
				}
			}
		}

		this.documents = new RefCountAsyncDisposableFactory(
			(uri) => createDocumentInit(uri).uri.toString(),
			async (uri) => {
				const result = createDocumentInit(uri)
				if (!result.language) {
					throw new Error("unreachable")
				}

				return await createDocument({
					uri: result.uri,
					languageId: result.language,
					version: 1,
					text: await this.trpc.vscode.workspace.fs.readFile.query({ uri: result.uri, encoding: result.encoding ?? "utf-8" }),
				})
			}
		)

		this.documentsDiagnostics = new Map()

		connection.onInitialize(async (params) => {
			console.log(`VDF Language Server v${version}`)
			console.log(platform)

			const initializationOptions = z.object({ teamFortress2Folder: Uri.schema }).parse(params.initializationOptions)

			onInitializePromise.resolve({
				teamFortress2Folder: initializationOptions.teamFortress2Folder,
				workspaceUris: params.workspaceFolders?.map((workspaceFolder) => new Uri(workspaceFolder.uri)) ?? [],
			})

			return {
				serverInfo: {
					name: "VDF Language Server",
					version: version,
				},
				capabilities: {
					// https://code.visualstudio.com/api/language-extensions/programmatic-language-features#language-features-listing
					textDocumentSync: TextDocumentSyncKind.Incremental,
					completionProvider: {
						triggerCharacters: [
							"[",
							"/",
							"\"",
							"#",
						],
						resolveProvider: true
					},
					hoverProvider: true,
					definitionProvider: true,
					referencesProvider: true,
					documentSymbolProvider: true,
					codeActionProvider: true,
					codeLensProvider: {
						resolveProvider: false
					},
					documentLinkProvider: {
						resolveProvider: true
					},
					colorProvider: true,
					documentFormattingProvider: true,
					inlayHintProvider: true,
					renameProvider: {
						prepareProvider: true
					}
				}
			}
		})

		connection.onInitialized(async (params) => {
			await connection.client.register(DidChangeConfigurationNotification.type, { section: "vscode-vdf" })
		})

		connection.onDidChangeConfiguration((params) => {
			onDidChangeConfiguration$.next()
		})

		const onDidClose = new Map<string, Promise<AsyncDisposable>>()
		this.stack.defer(async () => {
			await Promise.all(onDidClose.values().map(async (promise) => (await promise)[Symbol.asyncDispose]()))
		})

		const codeLensRefresh$ = new Subject<void>()
		const codeLensRequest$ = new Subject<void>()

		codeLensRefresh$.pipe(buffer(codeLensRequest$)).subscribe((requests) => {
			if (requests.length) {
				console.log(`${CodeLensRefreshRequest.method} ${requests.length}`)
				connection.sendRequest(CodeLensRefreshRequest.method)
			}
		})

		const sendDiagnostics = (document: TextDocument, diagnostics: DiagnosticCodeAction[]) => {
			const result: Diagnostic[] = []
			const map = new Map<number, DiagnosticCodeAction>()

			for (const diagnostic of diagnostics) {
				const id = this.diagnostic.id++
				const { data, ...rest } = diagnostic
				map.set(id, diagnostic)
				result.push({ ...rest, data: { id } })
			}

			this.documentsDiagnostics.set(document.uri.toString(), map)

			connection.sendDiagnostics({
				uri: document.uri.toString(),
				diagnostics: result
			})
		}

		connection.onDidOpenTextDocument(async (params) => {
			const uri = new Uri(params.textDocument.uri)
			const key = uri.toString()

			const { promise, resolve } = Promise.withResolvers<AsyncDisposable>()
			onDidClose.set(key, promise)

			const stack = new AsyncDisposableStack()

			const document = stack.use(await this.documents.get(uri, async (uri) => createDocument({ ...params.textDocument, uri: uri })))
			stack.use(await document.onDidOpenTextDocument(this, connection))

			stack.defer(async () => {
				this.documentsDiagnostics.delete(key)
			})

			stack.adopt(
				document.documentConfiguration$.pipe(
					distinctUntilKeyChanged("updateDiagnosticsEvent"),
					switchMap(({ updateDiagnosticsEvent }) => {
						return updateDiagnosticsEvent == "type"
							? document.diagnostics$
							: EMPTY
					})
				).subscribe((diagnostics) => {
					sendDiagnostics(document, diagnostics)
				}),
				(subscription) => {
					sendDiagnostics(document, [])
					subscription.unsubscribe()
				}
			)

			stack.adopt(
				document.codeLens$.pipe(
					skip(1 /* First codeLens should not trigger refresh request */)
				).subscribe((codeLens$) => {
					codeLensRefresh$.next()
				}),
				(subscription) => subscription.unsubscribe()
			)

			stack.adopt(
				document.decorations$.subscribe((decorations) => {
					this.trpc.textDocument.decoration.mutate({
						uri: uri,
						decorations: decorations
					})
				}),
				(subscription) => subscription.unsubscribe()
			)

			resolve(stack.move())
		})

		connection.onDidChangeTextDocument(async (params) => {
			if (params.contentChanges.length != 0) {
				await using document = await this.documents.get(new Uri(params.textDocument.uri))
				document.update(params.contentChanges, params.textDocument.version)
				codeLensRequest$.next()
			}
		})

		connection.onDidCloseTextDocument(async (params) => {
			const key = new Uri(params.textDocument.uri).toString()
			const disposable = onDidClose.get(key)
			onDidClose.delete(key)
			if (disposable) {
				(await disposable)[Symbol.asyncDispose]()
			}
		})

		connection.onDidSaveTextDocument(async (params) => {
			const uri = new Uri(params.textDocument.uri)
			await using document = await this.documents.get(uri)
			const documentConfiguration = await firstValueFrom(document.documentConfiguration$)

			if (documentConfiguration.updateDiagnosticsEvent == "save") {
				const diagnostics = await firstValueFrom(document.diagnostics$)
				sendDiagnostics(document, diagnostics)
			}
		})

		connection.onHover(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onHover(params)
		})

		connection.onDefinition(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onDefinition(params)
		})

		connection.onReferences(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onReferences(params)
		})

		connection.onDocumentSymbol(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await firstValueFrom<DocumentSymbol[]>(document.documentSymbols$)
		})

		const diagnosticDataSchema = z.object({ id: z.number() })

		connection.onCodeAction(async (params) => {
			const diagnostics = this.documentsDiagnostics.get(params.textDocument.uri)
			if (!diagnostics) {
				return null
			}

			const utils: Parameters<DiagnosticFix>[0] = {
				params: params,
				createDocumentWorkspaceEdit: (edit: TextEdit) => ({ changes: { [params.textDocument.uri]: [edit] } }),
			}

			const codeActions = params
				.context
				.diagnostics
				.values()
				.map((diagnostic) => {
					const result = diagnosticDataSchema.safeParse(diagnostic.data)
					if (!result.success) {
						return null
					}

					const diagnosticCodeAction = diagnostics.get(result.data.id)
					if (!diagnosticCodeAction) {
						return null
					}

					if (!diagnosticCodeAction.data) {
						return null
					}

					const codeAction = diagnosticCodeAction.data.fix(utils)
					if (!codeAction) {
						return null
					}

					if (params.context.only && codeAction.kind && !params.context.only.includes(codeAction.kind)) {
						return null
					}

					return {
						...codeAction,
						kind: CodeActionKind.QuickFix,
						diagnostics: [diagnostic],
					} satisfies CodeAction
				})
				.filter((codeAction) => codeAction != null)
				.toArray()

			const codes = Map.groupBy(
				codeActions,
				(codeAction) => codeAction.diagnostics[0].code
			)

			return [
				...codeActions,
				...codes
					.values()
					.filter((codeActions) => codeActions.length > 1)
					.map((codeActions) => {
						const changes: Record<string, TextEdit[]> = {}
						const commands: { command: string, rest?: any[] }[] = []

						for (const codeAction of codeActions) {
							if (codeAction.edit?.changes) {
								for (const uri in codeAction.edit.changes) {
									(changes[uri] ??= []).push(...codeAction.edit.changes[uri])
								}
							}
							if (codeAction.command) {
								commands.push({ command: codeAction.command.command, rest: codeAction.command.arguments })
							}
						}

						return {
							title: `Fix all issues of kind '${codeActions[0].diagnostics[0].message}' (${codeActions[0].diagnostics})`,
							diagnostics: codeActions.map((codeAction) => codeAction.diagnostics[0]),
							...(Object.keys(changes).length && {
								edit: {
									changes
								}
							}),
							...(commands.length && {
								command: {
									title: "",
									command: "vscode-vdf.executeCommands",
									arguments: [commands]
								}
							})
						} satisfies CodeAction
					})
					.toArray()
			]
		})

		connection.onCodeLens(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onCodeLens(params)
		})

		connection.onDocumentLinks(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onDocumentLinks()
		})

		connection.onDocumentLinkResolve(async (documentLink) => {
			const uri = Uri.schema.parse(documentLink.data.uri)
			await using document = await this.documents.get(uri)
			return await document.onDocumentLinkResolve(documentLink)
		})

		connection.onDocumentColor(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onDocumentColor()
		})

		connection.onColorPresentation(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onColorPresentation(params)
		})

		connection.onDocumentFormatting(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			const newText = await document.onDocumentFormatting(params)

			const MAX_VALUE = ((2 ** 31) - 1)

			return [
				{
					range: Range.create(0, 0, MAX_VALUE, MAX_VALUE),
					newText: newText
				}
			]
		})

		connection.onRequest(InlayHintRequest.method, async (params: InlayHintParams): Promise<InlayHint[]> => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			const range = new VDFRange(new VDFPosition(params.range.start.line, params.range.start.character), new VDFPosition(params.range.end.line, params.range.end.character))
			return await document.onInlayHint({ range })
		})

		connection.onCompletion(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			const configuration = await firstValueFrom(document.documentConfiguration$)
			if (!configuration[document.languageId].suggest.enable) {
				return null
			}

			return await document.onCompletion(params)
		})

		const CompletionItemDataSchema = z.object({ uri: Uri.schema })

		connection.onCompletionResolve(async (item) => {
			const { uri } = CompletionItemDataSchema.parse(item.data)
			await using document = await this.documents.get(uri)
			return await document.onCompletionResolve(item)
		})

		connection.onPrepareRename(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onPrepareRename(params)
		})

		connection.onRenameRequest(async (params) => {
			await using document = await this.documents.get(new Uri(params.textDocument.uri))
			return await document.onRenameRequest(params)
		})

		connection.listen()
	}
}
