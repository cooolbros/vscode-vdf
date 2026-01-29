import type { AnyTRPCRouter } from "@trpc/server"
import { TRPCRequestHandler } from "common/TRPCRequestHandler"
import type { Webview } from "vscode"
import { z } from "zod"

const messageSchema = z.object({
	type: z.union([z.literal("request"), z.literal("notification")]),
	method: z.string(),
	param: z.any()
})

export function TRPCWebViewRequestHandler<T extends AnyTRPCRouter>(webview: Webview, router: T): Disposable {

	const stack = new DisposableStack()

	const handlers = {
		request: new Map<string, (param: unknown) => void>(),
		notification: new Map<string, (param: unknown) => void>(),
	}

	stack.defer(() => handlers.request.clear())
	stack.defer(() => handlers.notification.clear())

	const controller = new AbortController()
	stack.defer(() => controller.abort())

	const trpc = TRPCRequestHandler({
		router: router,
		schema: z.enum(["webview"]),
		signal: controller.signal,
		onRequest: (method, handler) => {
			handlers.request.set(method, handler)
		},
		sendNotification: async (server, method, param) => {
			await webview.postMessage({
				type: "notification",
				method: method,
				param: param
			})
		}
	})

	handlers.request.set("vscode-vdf/trpc", async (param) => {
		webview.postMessage({
			type: "response",
			// @ts-ignore
			id: param.id,
			response: await trpc(param),
		})
	})

	stack.adopt(
		webview.onDidReceiveMessage((event) => {
			const { type, method, param } = messageSchema.parse(event)
			handlers[type].get(method)?.(param)
		}),
		(disposable) => disposable.dispose()
	)

	return stack
}
