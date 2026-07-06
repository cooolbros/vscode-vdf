import type { DataTransformer, TRPCRootObject } from "@trpc/server"
import { Uri } from "common/Uri"
import { commands, window, workspace } from "vscode"
import { z } from "zod"

export function TRPCImageRouter<T extends string>(t: TRPCRootObject<{ client: T }, object, { transformer: DataTransformer }>) {
	return t.router({
		showSaveDialog: t
			.procedure
			.query(async () => {
				const uri = await window.showSaveDialog({ filters: { Images: ["png", "jpg"] } })
				return uri != null
					? new Uri(uri).toJSON()
					: null
			}),
		save: t
			.procedure
			.input(
				z.object({
					uri: Uri.schema,
					buf: z.instanceof(Uint8Array),
				})
			)
			.mutation(async ({ input }) => {
				await workspace.fs.writeFile(input.uri, input.buf)
				commands.executeCommand("revealFileInOS", input.uri)
			})
	})
}
