import type { initTRPC } from "@trpc/server"
import type { DataTransformer } from "@trpc/server/unstable-core-do-not-import"
import { Uri } from "common/Uri"
import { commands, window, workspace } from "vscode"
import { z } from "zod"

export function TRPCImageRouter(t: ReturnType<typeof initTRPC.create<{ transformer: DataTransformer }>>,) {
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
