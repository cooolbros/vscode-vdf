import { FileType, Uri, workspace } from "vscode"
import { z } from "zod"
import { t } from "./TRPCServer"

const URISchema = z.object({
	uri: z.string().transform((arg) => {

		const sep = "://"
		const index = arg.indexOf(sep)
		const scheme = arg.substring(0, index)
		const [path, query] = arg.substring(index + sep.length).split("?")

		return Uri.from({
			scheme: scheme,
			path: path,
			query: query
		})
	})
})

const UTF8Decoder = new TextDecoder("utf-8")
const UTF16LEDecoder = new TextDecoder("utf-16le")

export const clientRouter = t.router({
	fs: t.router({
		exists: t.procedure.input(URISchema).query(async ({ input }) => {
			try {
				await workspace.fs.stat(input.uri)
				return true
			}
			catch (error: any) {
				return false
			}
		}),
		stat: t.procedure.input(URISchema).query(async ({ input }) => {
			return workspace.fs.stat(input.uri)
		}),
		readFile: t.procedure.input(URISchema).query(async ({ input }) => {
			const arr = await workspace.fs.readFile(input.uri)
			if (arr[0] == 255 && arr[1] == 254) {
				return UTF16LEDecoder.decode(arr)
			}
			return UTF8Decoder.decode(arr)
		}),
		readFileBinary: t.procedure.input(URISchema.merge(z.object({ begin: z.number().optional(), end: z.number().optional() }))).query(async ({ input }) => {
			return (await workspace.fs.readFile(input.uri)).subarray(input.begin, input.end)
		}),
		readDirectory: t.procedure.input(URISchema.merge(z.object({ recursive: z.boolean().default(false) }))).query(async ({ input }) => {
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
})
