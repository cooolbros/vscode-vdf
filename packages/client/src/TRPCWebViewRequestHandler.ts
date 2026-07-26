import type { AnyTRPCRouter } from "@trpc/server"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import vscode from "vscode"
import { z } from "zod"

const messageSchema = z.object({
	id: z.number(),
	message: z.any()
})

export interface TRPCWebViewRequestHandlerOptions<T extends z.util.EnumLike> {
	webview: vscode.Webview
	router: AnyTRPCRouter
	schema: z.ZodEnum<T>
}

export function TRPCWebViewRequestHandler<T extends z.util.EnumLike>(opts: TRPCWebViewRequestHandlerOptions<T>): AsyncDisposable {
	const { webview, router, schema } = opts
	const stack = new AsyncDisposableStack()

	const trpc = TRPCRequestHandler({
		router: router,
		schema: schema,
		stack: stack,
		sendNotification: async (server, method, param) => {
			await webview.postMessage({
				type: "notification",
				method: method,
				param: param
			})
		}
	})

	stack.adopt(
		webview.onDidReceiveMessage(async (event) => {
			const { id, message } = messageSchema.parse(event)

			webview.postMessage({
				type: "response",
				id: id,
				response: await trpc(message),
			})
		}),
		(disposable) => disposable.dispose()
	)

	return stack
}
