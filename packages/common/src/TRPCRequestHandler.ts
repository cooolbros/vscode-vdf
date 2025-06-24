import { experimental_localLink } from "@trpc/client"
import { type AnyTRPCRouter } from "@trpc/server"
import { observableToPromise, type Unsubscribable } from "@trpc/server/observable"
import { getErrorShape, getTRPCErrorFromUnknown, procedureTypes } from "@trpc/server/unstable-core-do-not-import"
import { z } from "zod"

export interface TRPCRequestHandlerOptions<T extends [string, ...string[]]> {
	router: AnyTRPCRouter
	schema: z.ZodEnum<T>
	onRequest: (method: string, handler: (param: unknown) => void) => void,
	sendNotification: (server: z.infer<z.ZodEnum<T>>, method: string, param: any) => Promise<any>
}

function next(): never {
	throw new Error("unreachable")
}

export function TRPCRequestHandler<T extends [string, ...string[]]>(opts: TRPCRequestHandlerOptions<T>) {

	const transformer = opts.router._def._config.transformer

	const opSchema = z.object({
		id: z.number(),
		type: z.enum(procedureTypes),
		input: z.unknown().optional().transform((arg) => transformer.input.deserialize(arg) as {}),
		path: z.string(),
		context: z.record(z.unknown()),
		signal: z.instanceof(AbortSignal).nullable().default(null),
	})

	const link = experimental_localLink<AnyTRPCRouter>({
		router: opts.router,
		createContext: async () => ({}),
		onError: (opts) => console.dir(opts),
		transformer: transformer,
	})({})

	const subscriptions = new Map<string, Map<number, Unsubscribable>>()

	opts.onRequest("vscode-vdf/trpc/observable/unsubscribe", (param: unknown) => {
		const { server, id } = z.object({ server: z.string(), id: z.number() }).parse(param)
		const subscription = subscriptions.get(server)?.get(id)
		subscriptions.get(server)?.delete(id)
		subscription?.unsubscribe()
		if (subscriptions.get(server)?.size == 0) {
			subscriptions.delete(server)
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
				const server = opts.schema.parse(op.context.name)
				let serverSubscriptions = subscriptions.get(server)
				if (!serverSubscriptions) {
					serverSubscriptions = new Map()
					subscriptions.set(server, serverSubscriptions)
				}
				serverSubscriptions.set(
					op.id,
					observable.subscribe({
						next: (value) => {
							if ("data" in value.result) {
								opts.sendNotification(server, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "N", value: transformer.output.serialize(value) } })
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
							opts.sendNotification(server, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "E", error: error } })
						},
						complete: () => {
							if (subscriptions.get(server)?.has(op.id)) {
								opts.sendNotification(server, "vscode-vdf/trpc/observable/next", { id: op.id, notification: { kind: "C" } })
							}
						},
					})
				)
		}
	}
}
