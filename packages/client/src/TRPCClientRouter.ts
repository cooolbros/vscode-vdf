import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { Uri } from "common/Uri"
import { commands, FileType, languages, window, workspace } from "vscode"
import { z } from "zod"
import { searchForHUDRoot } from "./searchForHUDRoot"

const URISchema = z.object({
	uri: Uri.schema
})

const UTF8Decoder = new TextDecoder("utf-8")
const UTF16LEDecoder = new TextDecoder("utf-16le")

export function TRPCClientRouter(
	t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>,
) {
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
