import { createTRPCClient as _createTRPCClient } from "@trpc/client"
import type { AnyTRPCRouter } from "@trpc/server"
import { Subject } from "rxjs"
import type { WebviewApi } from "vscode-webview"
import * as z from "zod/mini"
import { devalueTransformer } from "../devalueTransformer"
import { VSCodeJSONRPCLink } from "../VSCodeJSONRPCLink"

export interface CreateTRPCClientOptions {
	name: string
	vscode: WebviewApi<any>
}

export function createTRPCClient<T extends AnyTRPCRouter>(opts: CreateTRPCClientOptions) {
	const { name, vscode } = opts
	const requests = new Map<number, { resolve: (value: any) => void }>()

	const messageSchema = z.discriminatedUnion("type", [
		z.object({
			type: z.literal("response"),
			id: z.number(),
			response: z.optional(z.union([z.object({ result: z.object({ data: z.any() }) }), z.object({ error: z.any() })]))
		}),
		z.object({
			type: z.literal("notification"),
			method: z.string(),
			param: z.any(),
		}),
		z.object({
			type: z.literal("context_menu"),
			command: z.string(),
		})
	])

	const onResponse$ = new Subject<z.infer<typeof messageSchema.def.options[0]>>()
	const onNotification$ = new Subject<z.infer<typeof messageSchema.def.options[1]>>()
	const contextMenu$ = new Subject<z.infer<typeof messageSchema.def.options[2]>>()

	const subjects = {
		response: onResponse$,
		notification: onNotification$,
		context_menu: contextMenu$
	}

	window.addEventListener("message", (event) => {
		const message = messageSchema.parse(event.data)
		// @ts-ignore
		subjects[message.type].next(message)
	})

	onResponse$.subscribe((response) => {
		requests.get(response.id)?.resolve(response.response)
		requests.delete(response.id)
	})

	let id = 0

	const trpc = _createTRPCClient<T>({
		links: [
			VSCodeJSONRPCLink({
				client: { name: `${name}-webview` },
				transformer: devalueTransformer({ reducers: {}, revivers: {} }),
				onNotification: (type, handler) => {
					const subscription = onNotification$.subscribe((notification) => {
						if (notification.method == type) {
							handler(notification.param)
						}
					})
					return { [Symbol.dispose]: () => subscription.unsubscribe() }
				},
				sendRequest: async (method, param) => {
					const requestID = id++
					const { promise, resolve } = Promise.withResolvers()
					requests.set(requestID, { resolve })
					vscode.postMessage({ id: requestID, message: param })
					return promise
				},
			}),
		],
	})

	return {
		trpc,
		contextMenu$,
	}
}
