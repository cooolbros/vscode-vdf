import { TRPCClientError, type TRPCLink } from "@trpc/client"
import type { AnyTRPCRouter, TRPCCombinedDataTransformer } from "@trpc/server"
import { observable } from "@trpc/server/observable"
import { transformResult, type TRPCResponse } from '@trpc/server/unstable-core-do-not-import'
import { finalize, Subject } from "rxjs"
import { z } from "zod"

export interface VSCodeJSONRPCLinkOptions {
	name: string
	transformer: TRPCCombinedDataTransformer
	onNotification: (type: string, handler: (param: unknown) => void) => void
}

const nextSchema = z.object({
	id: z.number(),
	notification: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("N"), value: z.string() }),
		z.object({ kind: z.literal("E"), error: z.object({ message: z.string(), code: z.number(), }) }),
		z.object({ kind: z.literal("C") }),
	])
})

export function VSCodeJSONRPCLink(opts: VSCodeJSONRPCLinkOptions) {

	let id = 0
	const subjects = new Map<number, Subject<any>>()

	opts.onNotification("vscode-vdf/trpc/observable/next", (param) => {
		const { id, notification } = nextSchema.parse(param)

		const subject = subjects.get(id)
		if (!subject) {
			throw new Error(`${id}: ${JSON.stringify(notification)}`)
		}

		switch (notification.kind) {
			case "N":
				subject.next(opts.transformer.output.deserialize(notification.value))
				break
			case "E":
				subject.error(TRPCClientError.from(notification.error))
				break
			case "C":
				subjects.delete(id)
				subject.complete()
				break
		}
	})

	return ({ sendRequest }: { sendRequest: (method: string, param: unknown) => Promise<unknown> }): TRPCLink<AnyTRPCRouter> => {
		return () => {
			return ({ op }) => {
				return observable((observer) => {
					op.id = id++
					op.input = opts.transformer.input.serialize(op.input)
					switch (op.type) {
						case "query":
						case "mutation":
							sendRequest("vscode-vdf/trpc", op).then((json) => {
								const transformed = transformResult(
									json as TRPCResponse,
									opts.transformer.output,
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
							op.context.name = opts.name
							const subject = new Subject<any>()
							subjects.set(op.id, subject)
							sendRequest("vscode-vdf/trpc", op)
							return subject.pipe(
								finalize(() => {
									if (subjects.has(id)) {
										sendRequest("vscode-vdf/trpc/observable/unsubscribe", { server: opts.name, id: op.id })
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
}
