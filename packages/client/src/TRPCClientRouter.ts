import { lazy, type DataTransformer, type TRPCRootObject } from "@trpc/server"
import { observableToAsyncIterable } from "@trpc/server/observable"
import { BSP } from "bsp"
import type { FileSystemKey } from "common/FileSystemKey"
import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { usingAsync } from "common/operators/usingAsync"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import type { WatchEvent } from "common/WatchEvent"
import { concat, from, switchAll } from "rxjs"
import vscode from "vscode"
import { VTF, VTFToPNGBase64 } from "vtf-png"
import { z } from "zod"
import type { Decorations } from "./Decorations"
import type { FileSystemWatcherFactory } from "./FileSystemWatcherFactory"
import { searchForHUDRoot } from "./searchForHUDRoot"
import defer * as TRPCPopfileRouter from "./TRPCPopfileRouter"
import { VirtualFileSystem } from "./VirtualFileSystem/VirtualFileSystem"
import { VSCodeRangeSchema } from "./VSCodeSchemas"
import { initVTFPNG } from "./wasm/vtf"

export type ClientRouter = ReturnType<typeof TRPCClientRouter>

const URISchema = z.object({
	uri: Uri.schema
})

export function TRPCClientRouter(
	t: TRPCRootObject<{ client: "vdf" }, object, { transformer: DataTransformer }>,
	context: vscode.ExtensionContext,
	decorations: Decorations,
	fileSystemMountPointFactory: RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint>,
	fileSystemWatcherFactory: FileSystemWatcherFactory,
	bspFactory: RefCountAsyncDisposableFactory<Uri, BSP> | null,
) {
	const decoders = { "utf-8": new TextDecoder("utf-8"), "utf-16le": new TextDecoder("utf-16le") }
	const fileSystems = new Map<string, FileSystemMountPoint>()
	return t.router({
		vscode: {
			workspace: {
				fs: {
					stat: t
						.procedure
						.input(URISchema)
						.query(async ({ input }) => {
							return await vscode.workspace.fs.stat(input.uri)
						}),
					readFile: t
						.procedure
						.input(
							URISchema.extend({
								// https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings
								encoding: z.enum(["utf-8", "utf-16le"])
							})
						)
						.query(async ({ input }) => {
							const buf = await vscode.workspace.fs.readFile(input.uri)
							if (buf[0] == 255 && buf[1] == 254 && input.encoding != "utf-16le") {
								console.warn(`Reading ${input.uri.toString()} with LE BOM as ${input.encoding}`)
							}
							return decoders[input.encoding].decode(buf)
						}),
				},
				createFileSystemWatcher: t
					.procedure
					.input(URISchema)
					.subscription(async ({ input, signal }) => {
						return observableToAsyncIterable<WatchEvent>(
							concat(
								from(vscode.workspace.fs.stat(input.uri).then(
									(stat) => {
										switch (stat.type) {
											case vscode.FileType.File:
												return { type: <const>"create", entry: { type: <const>EntryType.File, uri: input.uri } }
											case vscode.FileType.Directory:
												return { type: <const>"create", entry: { type: <const>EntryType.Directory, uri: input.uri } }
											default:
												return { type: <const>"delete", entry: { type: <const>EntryType.None, uri: null } }
										}
									},
									() => ({ type: <const>"delete", entry: { type: <const>EntryType.None, uri: null } })
								)),
								usingAsync(async () => await fileSystemWatcherFactory.get(input.uri)).pipe(
									switchAll()
								)
							),
							signal!,
						)
					}),
				getConfiguration: t
					.procedure
					.input(
						z.object({
							section: z.string(),
						})
					)
					.query(async ({ input }) => {
						const [last, ...rest] = input.section.split(".").reverse()
						return vscode.workspace.getConfiguration(rest.reverse().join(".")).get(last)
					})
			},
		},
		searchForHUDRoot: t
			.procedure
			.input(URISchema)
			.query(async ({ input }) => await searchForHUDRoot(input.uri)),
		teamFortress2FileSystem: {
			open: t
				.procedure
				.input(
					z.object({
						paths: z.array(
							z.discriminatedUnion("type", [
								z.object({ type: z.literal("tf2"), teamFortress2Folder: Uri.schema }),
								z.object({ type: z.literal("folder"), folder: Uri.schema }),
								z.object({ type: z.literal("popfile:bsp"), teamFortress2Folder: Uri.schema, popfile: Uri.schema }),
								z.object({ type: z.literal("bsp"), bsp: Uri.schema }),
							])
						)
					})
				)
				.mutation(async ({ input }) => {
					const key = crypto.randomUUID()
					fileSystems.set(key, await VirtualFileSystem(input.paths.map(async (path) => await fileSystemMountPointFactory.get(path))))
					return {
						key: key,
						paths: input.paths
					}
				}),
			resolve: t
				.procedure
				.input(
					z.object({
						key: z.string(),
						path: z.string(),
					})
				)
				.subscription(({ input, signal }) => {
					return observableToAsyncIterable<Entry>(fileSystems.get(input.key)!.resolve(input.path), signal!)
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
			watchDirectory: t
				.procedure
				.input(
					z.object({
						key: z.string(),
						path: z.string(),
						options: z.object({
							pattern: z.string().optional()
						})
					})
				)
				.subscription(async ({ input, signal }) => {
					return observableToAsyncIterable<[string, vscode.FileType][]>(
						fileSystems.get(input.key)!.watchDirectory(input.path, input.options),
						signal!
					)
				}),
			dispose: t
				.procedure
				.input(
					z.object({
						key: z.string(),
					})
				)
				.mutation(async ({ input }) => {
					const fileSystem = fileSystems.get(input.key)
					fileSystems.delete(input.key)
					if (fileSystem) {
						await fileSystem[Symbol.asyncDispose]()
					}
				})
		},
		VTFToPNGBase64: t
			.procedure
			.input(URISchema)
			.query(async ({ input }) => {
				await initVTFPNG(context)
				using vtf = new VTF(await vscode.workspace.fs.readFile(input.uri))
				return VTFToPNGBase64(vtf, 256)
			}),
		textDocument: {
			decoration: {
				setDecorations: t
					.procedure
					.input(
						URISchema.extend({
							decorations: z.array(
								z.object({
									range: VSCodeRangeSchema,
									renderOptions: z.object({
										after: z.object({
											contentText: z.string()
										})
									})
								})
							)
						})
					)
					.mutation(async ({ input }) => {
						decorations.setDecorations(input.uri, input.decorations)
					}),
				removeDecorations: t
					.procedure
					.input(URISchema)
					.mutation(async ({ input }) => {
						decorations.removeDecorations(input.uri)
					})
			}
		},
		popfile: lazy(async () => TRPCPopfileRouter.TRPCPopfileRouter(t, fileSystemWatcherFactory, bspFactory)),
	})
}
