import type { initTRPC, TRPCCombinedDataTransformer } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { BSP } from "bsp"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { concat, distinctUntilChanged, from, map, Observable, switchAll } from "rxjs"
import vscode, { commands, languages, window, workspace, type ExtensionContext } from "vscode"
import { VTF, VTFToPNGBase64 } from "vtf-png"
import { z } from "zod"
import { decorationTypes, editorDecorations } from "./decorations"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { searchForHUDRoot } from "./searchForHUDRoot"
import { VirtualFileSystem } from "./VirtualFileSystem/VirtualFileSystem"
import { VSCodeRangeSchema } from "./VSCodeSchemas"
import { VTFDocument } from "./VTF/VTFDocument"
import { initBSP } from "./wasm/bsp"
import { initVTFPNG } from "./wasm/vtf"

const URISchema = z.object({
	uri: Uri.schema
})

const UTF8Decoder = new TextDecoder("utf-8")
const UTF16LEDecoder = new TextDecoder("utf-16le")

export function TRPCClientRouter(
	t: ReturnType<typeof initTRPC.create<{ transformer: TRPCCombinedDataTransformer }>>,
	context: ExtensionContext,
	teamFortress2Folder$: Observable<Uri>,
	fileSystemMountPointFactory: RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint>,
	fileSystemWatcherFactory: FileSystemWatcherFactory,
) {
	const fileSystems = new Map<string, FileSystemMountPoint>()
	return t.router({
		searchForHUDRoot: t
			.procedure
			.input(URISchema)
			.query(async ({ input }) => searchForHUDRoot(input.uri)),
		workspace: t.router({
			openTextDocument: t
				.procedure
				.input(URISchema.merge(z.object({ languageId: z.string() })))
				.query(async ({ input }) => {
					return {
						uri: input.uri,
						languageId: input.languageId,
						version: 1,
						content: await (async () => {
							const arr = await workspace.fs.readFile(input.uri)
							if (arr[0] == 255 && arr[1] == 254) {
								return UTF16LEDecoder.decode(arr)
							}
							return UTF8Decoder.decode(arr)
						})()
					}
				})
		}),
		teamFortress2FileSystem: t
			.router({
				teamFortress2Folder: t
					.procedure
					.subscription(({ signal }) => observableToAsyncIterable<Uri>(teamFortress2Folder$, signal!)),
				open: t
					.procedure
					.input(
						z.object({
							paths: z.union([
								z.object({ type: z.literal("tf2") }),
								z.object({ type: z.literal("folder"), uri: Uri.schema }),
							]).array()
						})
					)
					.mutation(async ({ input }) => {

						const key = JSON.stringify(input.paths)

						let fileSystem = fileSystems.get(key)
						if (!fileSystem) {
							const results = await Promise.allSettled(input.paths.map(async (path) => fileSystemMountPointFactory.get(path)))

							fileSystems.set(key, VirtualFileSystem(
								results
									.filter((result) => result.status == "fulfilled")
									.map((result) => result.value)
							))
						}

						return {
							key: key,
							paths: input.paths
						}
					}),
				resolveFile: t
					.procedure
					.input(
						z.object({
							key: z.string(),
							path: z.string(),
						})
					)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<Uri | null>(fileSystems.get(input.key)!.resolveFile(input.path), signal!)
					}),
				readDirectory: t
					.procedure
					.input(
						z.object({
							key: z.string(),
							path: z.string(),
							options: z.object({
								recursive: z.boolean().optional(),
								pattern: z.string().optional()
							})
						})
					)
					.query(async ({ input }) => {
						return await fileSystems.get(input.key)!.readDirectory(input.path, input.options)
					}),
				dispose: t
					.procedure
					.input(
						z.object({
							key: z.string(),
						})
					)
					.mutation(async ({ input }) => {
						fileSystems.get(input.key)?.[Symbol.asyncDispose]()
						fileSystems.delete(input.key)
					})
			}),
		VTFToPNGBase64: t
			.procedure
			.input(
				z.object({
					uri: Uri.schema
				})
			).mutation(async ({ input }) => {
				await initVTFPNG(context)
				const vtf = new VTF(await workspace.fs.readFile(input.uri))
				return VTFToPNGBase64(vtf, 256)
			}),
		window: t.router({
			createTextEditorDecorationType: t
				.procedure
				.input(
					z.object({
						options: z.object({
							after: z.object({
								margin: z.string(),
								color: z.string()
							})
						})
					})
				)
				.mutation(async ({ input }) => {
					const decorationType = window.createTextEditorDecorationType(input.options)
					decorationTypes.set(decorationType.key, decorationType)
					return decorationType.key
				}),
		}),
		textDocument: t.router({
			decoration: t
				.procedure
				.input(
					URISchema.merge(
						z.object({
							key: z.string(),
							decorations: z.object({
								range: VSCodeRangeSchema,
								renderOptions: z.object({
									after: z.object({
										contentText: z.string()
									})
								})
							}).array()
						})
					)
				)
				.mutation(async ({ input }) => {

					const decorationType = decorationTypes.get(input.key)
					if (!decorationType) {
						return
					}

					editorDecorations.set(
						input.uri.toString(),
						{
							decorationType: decorationType,
							decorations: input.decorations
						}
					)

					const editor = window.visibleTextEditors.find((editor) => editor.document.uri.toString() == input.uri.toString())
					if (editor) {
						editor.setDecorations(
							decorationType,
							input.decorations
						)
					}
				})
		}),
		popfile: t.router({
			bsp: t.router({
				entities: t
					.procedure
					.input(
						z.object({
							uri: Uri.schema
						})
					)
					.query(async ({ input }) => {
						try {
							await initBSP(context)
							const buf = await workspace.fs.readFile(input.uri)
							const bsp = new BSP(buf)
							return bsp.entities()
						}
						catch (error) {
							console.error(error)
							return null
						}
					})
			}),
			classIcon: t.router({
				flags: t
					.procedure
					.input(URISchema)
					.subscription(({ input, signal }) => {
						return observableToAsyncIterable<number>(
							concat(
								from(Promise.try(async () => VTFDocument.flags(await workspace.fs.readFile(input.uri)))),
								from(fileSystemWatcherFactory.get(input.uri)).pipe(
									switchAll(),
									map((buf) => VTFDocument.flags(buf))
								),
							).pipe(
								distinctUntilChanged(),
							),
							signal!
						)
					})
			}),
			vscript: t.router({
				install: t
					.procedure
					.input(
						z.object({
							name: z.string()
						})
					)
					.query(async ({ input }) => {
						const configuration = workspace.getConfiguration("vscode-vdf")
						if (configuration.get("popfile.vscript.enable") == true && !(await languages.getLanguages()).includes("squirrel")) {
							const result = await window.showInformationMessage(`VScript detected in ${input.name}. Install the TF2 VScript Support extension?`, "Yes", "No", "Don't ask again")
							switch (result) {
								case "Yes":
									await commands.executeCommand("vscode.open", vscode.Uri.from({ scheme: "vscode", path: "extension/ocet247.tf2-vscript-support" }))
									break
								case "No":
									break
								case "Don't ask again":
									configuration.update("popfile.vscript.enable", false, true)
									break
							}
						}
					})
			})
		})
	})
}
