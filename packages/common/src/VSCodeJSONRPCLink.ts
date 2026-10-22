import { TRPCClientError, type TRPCLink } from "@trpc/client"
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
])

export function VSCodeJSONRPCLink(opts: VSCodeJSONRPCLinkOptions): TRPCLink<AnyTRPCRouter> {

	let id = 0
	const subjects = new Map<number, Subject<any>>()

	if (!opts.stack) {
		console.warn(`No stack passed to VSCodeJSONRPCLink, subscriptions will be leaked!`)
	}

	opts.stack?.defer(async () => {
		if (subjects.size) {
			debugger
			console.warn(`[VSCodeJSONRPCLink] ${subjects.size} subscriptions`)
		}
	})

	const promises = new Map<number, Promise<void>>()
	opts.stack?.defer(async () => void await Promise.all(promises.values()))

	const disposable = opts.onNotification("vscode-vdf/trpc", async (param) => {
		const notification = notificationSchema.parse(param)
		const { id, value } = notification.value

		const subject = subjects.get(id)
		if (!subject) {
			throw new Error(`${id}: ${JSON.stringify(value)}`)
		}

		switch (value.kind) {
			case "N":
				subject.next(opts.transformer.deserialize(value.value))
				break
			case "E":
				subject.error(TRPCClientError.from(value.error))
				break
			case "C":
				subjects.delete(id)
				subject.complete()
				break
		}
	})

	if (opts.stack) {
		opts.stack.use(disposable)
	}

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
						const subject = new Subject<any>()
						subjects.set(op.id, subject)
						opts.sendRequest("vscode-vdf/trpc", { type: "request", op: op })
						return subject.pipe(
							finalize(() => {
								// Only send unsubscribe request if "C" complete notification not received
								if (subjects.has(op.id)) {
									promises.set(
										op.id,
										opts
											.sendRequest("vscode-vdf/trpc", { type: "unsubscribe", client: op.context.client, ids: [op.id] })
											.then(() => void promises.delete(op.id))
									)
								}
								subjects.delete(op.id)
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
