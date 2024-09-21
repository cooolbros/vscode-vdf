import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { Uri } from "common/Uri"
import { commands, FileType, languages, window, workspace } from "vscode"
import { z } from "zod"
import { searchForHUDRoot } from "./searchForHUDRoot"
import type { FileSystemMountPoint } from "./VirtualFileSystem/FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "./VirtualFileSystem/FileSystemMountPointFactory"
import { VirtualFileSystem } from "./VirtualFileSystem/VirtualFileSystem"

const URISchema = z.object({
	uri: Uri.schema
})

const UTF8Decoder = new TextDecoder("utf-8")
const UTF16LEDecoder = new TextDecoder("utf-16le")

export function TRPCClientRouter(
	t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>,
	fileSystemNodeFactory: FileSystemMountPointFactory,
	update: (key: string, path: string, uri: Uri | null) => Promise<void>,
) {
	const fileSystems = new Map<string, FileSystemMountPoint>()
	return t.router({
		fileSystem: t.router({
			exists: t
				.procedure
				.input(URISchema)
				.query(async ({ input }) => {
					try {
						await workspace.fs.stat(input.uri)
						return true
					}
					catch (error: any) {
						return false
					}
				}),
			stat: t
				.procedure
				.input(URISchema)
				.query(async ({ input }) => {
					return workspace.fs.stat(input.uri)
				}),
			readFile: t
				.procedure
				.input(URISchema)
				.query(async ({ input }) => {
					const arr = await workspace.fs.readFile(input.uri)
					if (arr[0] == 255 && arr[1] == 254) {
						return UTF16LEDecoder.decode(arr)
					}
					return UTF8Decoder.decode(arr)
				}),
			readFileBinary: t
				.procedure
				.input(
					URISchema
						.merge(
							z.object({
								begin: z.number().optional(),
								end: z.number().optional()
							})
						)
				)
				.query(async ({ input }) => {
					return new Uint8Array((await workspace.fs.readFile(input.uri)).subarray(input.begin, input.end))
				}),
			readDirectory: t
				.procedure
				.input(
					URISchema
						.merge(
							z.object({
								recursive: z.boolean().default(false)
							})
						)
				)
				.query(async ({ input }) => {
					if (!input.recursive) {
						return await workspace.fs.readDirectory(input.uri)
					}

					const paths: [string, FileType][] = []
					const iterateDirectory = async (relativePath: string) => {
						for (const [name, type] of await workspace.fs.readDirectory(input.uri.with({ path: `${input.uri.path}/${relativePath}` }))) {
							const path = relativePath != "" ? `${relativePath}/${name}` : name
							paths.push([path, type])
							if (type == FileType.Directory) {
								await iterateDirectory(path)
							}
						}
					}
					await iterateDirectory("")
					return paths
				})
		}),
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
				open: t
					.procedure
					.input(
						z.object({
							paths: z.object({
								type: z.enum(["folder", "tf2", "vpk", "wildcard"]),
								uri: Uri.schema
							}).array()
						})
					)
					.mutation(async ({ input }) => {

						const key = JSON.stringify(input.paths)

						let fileSystem = fileSystems.get(key)
						if (!fileSystem) {
							const results = await Promise.allSettled(
								input.paths.map(async ({ type, uri }) => {
									switch (type) {
										case "folder":
											return await fileSystemNodeFactory.folder(uri)
										case "tf2":
											return await fileSystemNodeFactory.tf2(uri)
										case "vpk":
											return await fileSystemNodeFactory.vpk(uri)
										case "wildcard":
											return await fileSystemNodeFactory.wildcard(uri)
									}
								})
							)

							fileSystems.set(key, VirtualFileSystem(
								results
									.filter((result) => result.status == "fulfilled")
									.map((result) => result.value)
							))
						}

						return {
							key
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
					.query(async ({ input }) => {
						return await fileSystems.get(input.key)!.resolveFile(input.path, async (uri) => await update(input.key, input.path, uri))
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
				remove: t
					.procedure
					.input(
						z.object({
							key: z.string(),
							path: z.string(),
						})
					)
					.query(async ({ input }) => {
						return fileSystems.get(input.key)!.remove(input.path)
					}),
				dispose: t
					.procedure
					.input(
						z.object({
							key: z.string(),
						})
					)
					.mutation(async ({ input }) => {
						fileSystems.get(input.key)?.dispose()
						fileSystems.delete(input.key)
					})
			}),
		popfile: t.router({
			vscript: t.router({
				install: t
					.procedure
					.input(
						z.object({
							name: z.string()
						})
					).query(async ({ input }) => {
						const configuration = workspace.getConfiguration("vscode-vdf")
						if (configuration.get("popfile.vscript.enable") == true && !(await languages.getLanguages()).includes("squirrel")) {
							const result = await window.showInformationMessage(`VScript detected in ${input.name}. Install a VScript extension?`, "Yes", "No", "Don't ask again")
							switch (result) {
								case "Yes":
									await commands.executeCommand("workbench.extensions.search", "@ext:nut")
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
