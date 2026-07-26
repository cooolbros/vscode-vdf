import { TRPCClientError, type Operation, type TRPCLink } from "@trpc/client"
import type { AnyTRPCRouter, DataTransformer } from "@trpc/server"
import { observable } from "@trpc/server/observable"
import { transformResult, type TRPCResponse } from '@trpc/server/unstable-core-do-not-import'
import { finalize, Subject } from "rxjs"
import * as z from "zod/mini"

export interface VSCodeJSONRPCLinkOptions {
	stack?: AsyncDisposableStack
	client: { name: string }
	transformer: DataTransformer
	onNotification: (type: "vscode-vdf/trpc", handler: (param: unknown) => Promise<void>) => Disposable
	sendRequest: (method: "vscode-vdf/trpc", param: unknown) => Promise<unknown>
}

const notificationSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("start"),
	}),
	z.object({
		type: z.literal("next"),
		value: z.object({
			id: z.number(),
			value: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("N"), value: z.string() }),
				z.object({ kind: z.literal("E"), error: z.object({ message: z.string(), code: z.number(), }) }),
				z.object({ kind: z.literal("C") }),
			])
		})
	}),
	z.object({
		type: z.literal("exit"),
	})
])

export function VSCodeJSONRPCLink(opts: VSCodeJSONRPCLinkOptions): TRPCLink<AnyTRPCRouter> {

	let id = 0
	let connected = true
	const subscriptions = new Map<number, { op: Operation<unknown>, subject: Subject<any> }>()

	opts.stack?.defer(async () => {
		if (subscriptions.size) {
			console.warn(`[VSCodeJSONRPCLink] ${subscriptions.size} subscriptions`)
		}
	})

	const promises = new Map<number, Promise<void>>()
	opts.stack?.defer(async () => void await Promise.all(promises.values()))

	opts.stack?.use(
		opts.onNotification("vscode-vdf/trpc", async (param) => {
			const notification = notificationSchema.parse(param)
			switch (notification.type) {
				case "start": {
					if (!connected) {
						for (const { op } of subscriptions.values()) {
							opts.sendRequest("vscode-vdf/trpc", { type: "request", op: op })
						}
					}
					break
				}
				case "next": {
					const { id, value } = notification.value

					const subscription = subscriptions.get(id)
					if (!subscription) {
						throw new Error(`${id}: ${JSON.stringify(value)}`)
					}

					switch (value.kind) {
						case "N":
							subscription.subject.next(opts.transformer.deserialize(value.value))
							break
						case "E":
							subscription.subject.error(TRPCClientError.from(value.error))
							break
						case "C":
							subscriptions.delete(id)
							subscription.subject.complete()
							break
					}
					break
				}
				case "exit": {
					connected = false
					break
				}
			}
		})
	)

	return () => {
		return ({ op }) => {
			return observable((observer) => {
				op.id = id++
				op.input = opts.transformer.serialize(op.input)
				op.context.client = opts.client.name
				switch (op.type) {
					case "query":
					case "mutation":
						opts.sendRequest("vscode-vdf/trpc", { type: "request", op: op }).then((json) => {
							const transformed = transformResult(
								json as TRPCResponse,
								opts.transformer,
							)

							if (!transformed.ok) {
								observer.error(TRPCClientError.from(transformed.error))
								return
							}

							observer.next({ result: transformed.result })
							observer.complete()
						})
						break
					case "subscription":
						const subscription = { op: op, subject: new Subject<any>() }
						subscriptions.set(op.id, subscription)
						opts.sendRequest("vscode-vdf/trpc", { type: "request", op: op })
						return subscription.subject.pipe(
							finalize(() => {
								// Only send unsubscribe request if "C" complete notification not received
								if (subscriptions.has(op.id)) {
									promises.set(
										op.id,
										opts
											.sendRequest("vscode-vdf/trpc", { type: "unsubscribe", client: op.context.client, ids: [op.id] })
											.then(() => void promises.delete(op.id))
									)
								}
								subscriptions.delete(op.id)
							})
						).subscribe({
							next: (value) => observer.next(value),
							error: (err) => observer.error(err),
							complete: () => observer.complete(),
						})
				}
			})
		}
	}
}
