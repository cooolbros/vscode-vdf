import { unstable_localLink } from "@trpc/client"
import { type AnyTRPCRouter } from "@trpc/server"
import { observableToPromise, type Unsubscribable } from "@trpc/server/observable"
import { getErrorShape, getTRPCErrorFromUnknown, procedureTypes } from "@trpc/server/unstable-core-do-not-import"
import { z } from "zod"

export interface TRPCRequestHandlerOptions<T extends z.util.EnumLike> {
	router: AnyTRPCRouter
	schema: z.ZodEnum<T>
	stack?: AsyncDisposableStack
	sendNotification: (client: z.infer<z.ZodEnum<T>>, method: "vscode-vdf/trpc", param: unknown) => Promise<void>
	start?: Promise<z.infer<z.ZodEnum<T>>[]>
	onExit?: (clients: Set<z.infer<z.ZodEnum<T>>>) => Promise<void>
}

function next(): never {
	throw new Error("unreachable")
}

export function TRPCRequestHandler<T extends z.util.EnumLike>(opts: TRPCRequestHandlerOptions<T>) {

	const transformer = opts.router._def._config.transformer

	const requestSchema = z.discriminatedUnion("type", [
		z.object({
			type: z.literal("request"),
			op: z.object({
				id: z.number(),
				type: z.enum(procedureTypes),
				input: z.unknown().optional().transform((arg) => transformer.input.deserialize(arg) as {}),
				path: z.string(),
				context: z.object({ client: opts.schema }),
				signal: z.instanceof(AbortSignal).nullable().default(null),
			})
		}),
		z.object({
			type: z.literal("unsubscribe"),
			client: opts.schema,
			ids: z.array(z.number()),
		})
	])

	const subscriptions = new Map<z.infer<z.ZodEnum<T>>, Map<number, Unsubscribable>>()

	opts.stack?.defer(async () => {
		const clients = new Set(subscriptions.keys())
		const promises: Promise<void>[] = [Promise.try(() => opts.onExit?.(clients))]

		for (const [client, map] of subscriptions) {
			for (const subscription of map.values()) {
				subscription.unsubscribe()
			}

			promises.push(opts.sendNotification(client, "vscode-vdf/trpc", { type: "exit" }))
		}

		await Promise.all(promises)
	})

	opts.start?.then((clients) => {
		for (const client of clients) {
			opts.sendNotification(client, "vscode-vdf/trpc", { type: "start" })
		}
	})

	return async (param: unknown) => {
		const request = requestSchema.parse(param)

		switch (request.type) {
			case "request": {
				const op = request.op

				const link = unstable_localLink({
					router: opts.router,
					createContext: async () => op.context,
					onError: (opts) => console.dir(opts),
					transformer: transformer,
				})({})

				const observable = link({ op, next })
				switch (op.type) {
					case "query":
					case "mutation":
						return await observableToPromise(observable)
							.then((value) => ({ result: { data: transformer.output.serialize(value.result.data) } }))
							.catch((err) => {
								console.dir(err)
								const error = getErrorShape({
									config: opts.router._def._config,
									error: getTRPCErrorFromUnknown(err),
									type: op.type,
									path: op.path,
									input: op.input,
									ctx: op.context,
								})
								console.dir(error)
								return { error: transformer.output.serialize(error) }
							})
					case "subscription":
						const client = op.context.client
						const clientSubscriptions = subscriptions.getOrInsertComputed(client, () => new Map())
						clientSubscriptions.set(
							op.id,
							observable.subscribe({
								next: (value) => {
									// Don't check (value.result.type == "data") because tRPC doesn't include { type: "data" } in "data" results
									if ("data" in value.result) {
										opts.sendNotification(client, "vscode-vdf/trpc", { type: "next", value: { id: op.id, value: { kind: "N", value: transformer.output.serialize(value) } } })
									}
								},
								error: (err) => {
									console.dir(err)
									const error = getErrorShape({
										config: opts.router._def._config,
										error: getTRPCErrorFromUnknown(err),
										type: "subscription",
										path: op.path,
										input: op.input,
										ctx: op.context,
									})
									console.dir(error)
									opts.sendNotification(client, "vscode-vdf/trpc", { type: "next", value: { id: op.id, value: { kind: "E", error: error } } })
								},
								complete: () => {
									if (subscriptions.get(client)?.has(op.id)) {
										opts.sendNotification(client, "vscode-vdf/trpc", { type: "next", value: { id: op.id, value: { kind: "C" } } },)
									}
								},
							})
						)
				}
				break
			}
			case "unsubscribe": {
				const { client, ids } = request

				const clientSubscriptions = subscriptions.get(client)
				if (!clientSubscriptions) {
					return
				}

				for (const id of ids) {
					clientSubscriptions.get(id)?.unsubscribe()
					clientSubscriptions.delete(id)
				}

				if (clientSubscriptions.size == 0) {
					subscriptions.delete(client)
				}

				break
			}
		}
	}
}
