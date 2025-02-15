import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { BSP } from "bsp"
import { Uri } from "common/Uri"
import { firstValueFrom } from "rxjs"
import { commands, languages, window, workspace } from "vscode"
import { VTF, VTFToPNG } from "vtf-png"
import { z } from "zod"
import { decorationTypes, editorDecorations } from "./decorations"
import { searchForHUDRoot } from "./searchForHUDRoot"
import type { FileSystemMountPoint } from "./VirtualFileSystem/FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "./VirtualFileSystem/FileSystemMountPointFactory"
import { VirtualFileSystem } from "./VirtualFileSystem/VirtualFileSystem"
import { VSCodeRangeSchema } from "./VSCodeSchemas"

const URISchema = z.object({
	uri: Uri.schema
})

const UTF8Decoder = new TextDecoder("utf-8")
const UTF16LEDecoder = new TextDecoder("utf-16le")

export function TRPCClientRouter(
	t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>,
	fileSystemMountPointFactory: FileSystemMountPointFactory
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
											return await fileSystemMountPointFactory.folder(uri)
										case "tf2":
											return await fileSystemMountPointFactory.tf2(uri)
										case "vpk":
											return await fileSystemMountPointFactory.vpk(uri)
										case "wildcard":
											return await fileSystemMountPointFactory.wildcard(uri)
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
					.query(async ({ input }) => {
						const observable = fileSystems.get(input.key)!.resolveFile(input.path)
						await firstValueFrom(observable)
						return observable
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
						fileSystems.get(input.key)?.dispose()
						fileSystems.delete(input.key)
					})
			}),
		VTFToPNG: t
			.procedure.input(
				z.object({
					uri: Uri.schema
				})
			).mutation(async ({ input }) => {
				const vtf = new VTF(await workspace.fs.readFile(input.uri))
				return VTFToPNG(vtf, 256)
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
