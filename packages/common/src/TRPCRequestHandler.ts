import { experimental_localLink } from "@trpc/client"
import { type AnyTRPCRouter } from "@trpc/server"
import { observableToPromise, type Unsubscribable } from "@trpc/server/observable"
import { getErrorShape, getTRPCErrorFromUnknown, procedureTypes } from "@trpc/server/unstable-core-do-not-import"
import { z } from "zod"

export interface TRPCRequestHandlerOptions<T extends z.util.EnumLike> {
	router: AnyTRPCRouter
	schema: z.ZodEnum<T>
	signal?: AbortSignal,
	onRequest: (method: string, handler: (param: unknown) => void) => void,
	sendNotification: (server: z.infer<z.ZodEnum<T>>, method: string, param: any) => Promise<any>
}

function next(): never {
	throw new Error("unreachable")
}

export function TRPCRequestHandler<T extends z.util.EnumLike>(opts: TRPCRequestHandlerOptions<T>) {

	const transformer = opts.router._def._config.transformer

	const opSchema = z.object({
		id: z.number(),
		type: z.enum(procedureTypes),
		input: z.unknown().optional().transform((arg) => transformer.input.deserialize(arg) as {}),
		path: z.string(),
		context: z.record(z.string(), z.unknown()),
		signal: z.instanceof(AbortSignal).nullable().default(null),
	})

	const link = experimental_localLink<AnyTRPCRouter>({
		router: opts.router,
		createContext: async () => ({}),
		onError: (opts) => console.dir(opts),
		transformer: transformer,
	})({})

	const subscriptions = new Map<z.infer<z.ZodEnum<T>>, Map<number, Unsubscribable>>()

	opts.signal?.addEventListener("abort", () => {
		for (const [client, map] of subscriptions) {
			for (const [id, subscription] of map) {
				subscription.unsubscribe()
				map.delete(id)
			}
			subscriptions.delete(client)
		}
	})

	opts.onRequest("vscode-vdf/trpc/observable/unsubscribe", (param: unknown) => {
		const { client, id } = z.object({ client: opts.schema, id: z.number() }).parse(param)
		const subscription = subscriptions.get(client)?.get(id)
		subscriptions.get(client)?.delete(id)
		subscription?.unsubscribe()
		if (subscriptions.get(client)?.size == 0) {
			subscriptions.delete(client)
		}
	})

	return async (param: unknown) => {
		const op = opSchema.parse(param)
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
						return { error: error }
					})
			case "subscription":
				const client = opts.schema.parse(op.context.client)
				let clientSubscriptions = subscriptions.get(client)
				if (!clientSubscriptions) {
					clientSubscriptions = new Map()
					subscriptions.set(client, clientSubscriptions)
				}
				clientSubscriptions.set(
					op.id,
					observable.subscribe({
						next: (value) => {
							if ("data" in value.result) {
								opts.sendNotification(client, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "N", value: transformer.output.serialize(value) } })
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
							opts.sendNotification(client, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "E", error: error } })
						},
						complete: () => {
							if (subscriptions.get(client)?.has(op.id)) {
								opts.sendNotification(client, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "C" } })
							}
						},
					})
				)
		}
	}
}
