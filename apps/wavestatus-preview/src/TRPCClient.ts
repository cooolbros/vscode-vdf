import { createTRPCClient } from "@trpc/client"
import type { showWaveStatusPreviewToSide } from "client/commands/showWaveStatusPreviewToSide"
import { devalueTransformer } from "common/devalueTransformer"
import { VSCodeJSONRPCLink } from "common/VSCodeJSONRPCLink"
import { filter, fromEvent, map, partition } from "rxjs"
import { z } from "zod"

type AppRouter = NonNullable<Awaited<ReturnType<ReturnType<typeof showWaveStatusPreviewToSide>>>>

const vscode = acquireVsCodeApi()
const requests = new Map<number, { resolve: (value: any) => void }>()

const messageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("response"),
		id: z.number(),
		response: z
			.union([z.object({ result: z.object({ data: z.any() }) }), z.object({ error: z.any() })])
			.optional(),
	}),
	z.object({
		type: z.literal("notification"),
		method: z.string(),
		param: z.any(),
	}),
])

const [onResponse$, onNotification$] = partition(
	fromEvent<MessageEvent>(window, "message").pipe(map((event) => messageSchema.parse(event.data))),
	(message) => message.type == "response",
)

onResponse$.subscribe((response) => {
	requests.get(response.id)?.resolve(response.response)
	requests.delete(response.id)
})

export const trpc = createTRPCClient<AppRouter>({
	links: [
		VSCodeJSONRPCLink({
			name: "webview",
			transformer: devalueTransformer({ reducers: {}, revivers: {} }),
			onNotification: (type, handler) => {
				onNotification$
					.pipe(filter((notification) => notification.method == type))
					.subscribe((notification) => {
						handler(notification.param)
					})
			},
		})({
			sendRequest: async (method, param) => {
				const { promise, resolve } = Promise.withResolvers()
				// @ts-ignore
				requests.set(param.id, { resolve })
				vscode.postMessage({ type: "request", method, param })
				return promise
			},
		}),
	],
})
