import * as devalue from "devalue"
import { identity, isObservable, Observable, shareReplay, skip, startWith, Subject, Subscription } from "rxjs"
import { VDFPosition, VDFRange } from "vdf"
import { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { z } from "zod"
import { Uri } from "./Uri"
import { VSCodeVDFLanguageIDSchema, type VSCodeVDFLanguageID } from "./VSCodeVDFLanguageID"

export interface Options {
	reducers: Record<string, (value: unknown) => any>
	revivers: Record<string, (value: any) => any>
	name: VSCodeVDFLanguageID | null
	subscriptions: { dispose(): any }[]
	onRequest(method: string, handler: (...params: any[]) => any): { dispose(): any }
	onNotification(method: string, handler: (...params: any[]) => any): { dispose(): any }
	sendRequest(server: VSCodeVDFLanguageID | null, method: `vscode-vdf/observable/${"subscribe" | "unsubscribe" | "free"}`, param: any): Promise<any>
	sendNotification(server: VSCodeVDFLanguageID, method: "vscode-vdf/observable/next", param: z.infer<typeof nextSchema>): Promise<void>
}

const common = {
	reducers: {
		Symbol: (value: unknown) => typeof value == "symbol" ? Symbol.keyFor(value) : undefined,
		Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
		VDFDocumentSymbol: (value: unknown) => value instanceof VDFDocumentSymbol ? value.toJSON() : undefined,
		VDFDocumentSymbols: (value: unknown) => value instanceof VDFDocumentSymbols ? value.toJSON() : undefined,
		VDFPosition: (value: unknown) => value instanceof VDFPosition ? value.toJSON() : undefined,
		VDFRange: (value: unknown) => value instanceof VDFRange ? value.toJSON() : undefined,
	},
	revivers: {
		Symbol: (value: ReturnType<Symbol["toString"]>) => Symbol.for(value),
		Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
		VDFDocumentSymbol: (value: ReturnType<VDFDocumentSymbol["toJSON"]>) => VDFDocumentSymbol.schema.parse(value),
		VDFDocumentSymbols: (value: ReturnType<VDFDocumentSymbols["toJSON"]>) => VDFDocumentSymbols.schema.parse(value),
		VDFPosition: (value: ReturnType<VDFPosition["toJSON"]>) => VDFPosition.schema.parse(value),
		VDFRange: (value: ReturnType<VDFRange["toJSON"]>) => VDFRange.schema.parse(value),
	}
}

const paramsSchema = z.object({
	server: VSCodeVDFLanguageIDSchema,
	id: z.string(),
})

const nextSchema = z.object({
	id: z.string().uuid(),
	notification: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("N"), value: z.string() }),
		z.object({ kind: z.literal("E"), error: z.any() }),
		z.object({ kind: z.literal("C") }),
	])
})

const heldValueSchema = z.object({
	server: VSCodeVDFLanguageIDSchema.nullable(),
	params: paramsSchema,
})

class BidirectionalMap<K, V> {
	private readonly map = new Map<K, V>()
	private readonly reverse = new Map<V, K>()

	public getByKey(key: K) {
		return this.map.get(key)
	}

	public setByKey(key: K, value: V) {
		this.map.set(key, value)
		this.reverse.set(value, key)
	}

	public getByValue(value: V) {
		return this.reverse.get(value)
	}

	public setByValue(value: V, key: K) {
		this.map.set(key, value)
		this.reverse.set(value, key)
	}

	public deleteByKey(key: K) {
		const value = this.map.get(key)
		this.map.delete(key)
		if (value) {
			this.reverse.delete(value)
		}
	}

	public deleteByValue(value: V) {
		const key = this.reverse.get(value)
		this.reverse.delete(value)
		if (key) {
			this.map.delete(key)
		}
	}
}

export function devalueTransformer({ reducers, revivers, name, subscriptions, onRequest, onNotification, sendRequest, sendNotification }: Options) {

	const observables = new BidirectionalMap<string, Observable<any>>()
	const serversSubscriptions = new Map<VSCodeVDFLanguageID | null, Map<string, { subscription?: Subscription }>>()

	const subjects = new Map<string, { subject: Subject<any>, ref: WeakRef<Observable<any>> }>()
	const registry = new FinalizationRegistry<string>((heldValue) => {
		const { server, params } = heldValueSchema.parse(JSON.parse(heldValue))
		subjects.delete(heldValue)
		sendRequest(server, "vscode-vdf/observable/free", params)
	})

	subscriptions.push(
		onRequest("vscode-vdf/observable/subscribe", (param: unknown) => {
			const { server, id, skip1 } = paramsSchema.extend({ skip1: z.boolean().optional() }).parse(param)

			let serverSubscriptions = serversSubscriptions.get(server)
			if (!serverSubscriptions) {
				serverSubscriptions = new Map()
				serversSubscriptions.set(server, serverSubscriptions)
			}

			const observable = observables.getByKey(id)
			if (!observable) {
				throw new Error(`No observable "${id}" for subscribe`)
			}

			let subscription = serverSubscriptions.get(id)?.subscription
			if (subscription) {
				subscription.unsubscribe()
				serverSubscriptions.delete(id)
			}

			subscription = observable.pipe(skip1 ? skip(1) : identity).subscribe({
				next: (value) => sendNotification(server, "vscode-vdf/observable/next", { id: id, notification: { kind: "N", value: devalue.stringify(value, inputReducers) } }),
				error: (err) => sendNotification(server, "vscode-vdf/observable/next", { id: id, notification: { kind: "E", error: err } }),
				complete: () => sendNotification(server, "vscode-vdf/observable/next", { id: id, notification: { kind: "C" } })
			})

			subscription.add(() => delete serverSubscriptions.get(id)?.subscription)
			serverSubscriptions.set(id, { subscription: subscription })
		}),
		onRequest("vscode-vdf/observable/unsubscribe", (param: unknown) => {
			const { server, id } = paramsSchema.parse(param)
			serversSubscriptions.get(server)?.get(id)?.subscription?.unsubscribe()
		}),
		onRequest("vscode-vdf/observable/free", (param: unknown) => {
			const { server, id } = paramsSchema.parse(param)

			const subscription = serversSubscriptions.get(server)?.get(id)?.subscription
			if (subscription != undefined) {
				throw new Error(`Cannot free ${id} with subscription`)
			}

			serversSubscriptions.get(server)?.delete(id)
			if (serversSubscriptions.values().every((map) => !map.has(id))) {
				observables.deleteByKey(id)
			}
		}),
		onNotification("vscode-vdf/observable/next", (param: unknown) => {
			const { id, notification } = nextSchema.parse(param)

			const subject = subjects.get(id)
			if (!subject) {
				throw new Error(`No subject "${id}" for next`)
			}

			switch (notification.kind) {
				case "N": {
					subject.subject.next(devalue.parse(notification.value, inputRevivers))
					break
				}
				case "E": {
					subject.subject.error(notification.error)
					break
				}
				case "C": {
					subject.subject.complete()
				}
			}
		})
	)

	const inputReducers = {
		...common.reducers,
		...reducers,
		Observable: (value: unknown) => {
			if (isObservable(value)) {
				throw new Error("Cannot stringify input Observable")
			}
		}
	}

	const inputRevivers = {
		...common.revivers,
		...revivers
	}

	const outputReducers = {
		...common.reducers,
		...reducers,
		Observable: (value: unknown) => {
			if (isObservable(value)) {
				let id = observables.getByValue(value)
				if (!id) {
					id = crypto.randomUUID()
					observables.setByValue(value, id)
				}

				let current = undefined
				value
					.subscribe((value) => current = value)
					.unsubscribe()

				return { server: name, id: id, current: current }
			}
		}
	}

	const outputRevivers = {
		...common.revivers,
		...revivers,
		...(name != null && {
			Observable: (value: NonNullable<ReturnType<(typeof outputReducers)["Observable"]>>) => {
				if (subjects.has(value.id)) {
					const observable = subjects.get(value.id)!.ref.deref()
					if (observable) {
						return observable
					}
				}

				const subject = new Subject()
				const params: z.infer<typeof paramsSchema> = { server: name, id: value.id }

				const observable = new Observable((subscriber) => {
					const subscription = subject.subscribe(subscriber)
					sendRequest(value.server, "vscode-vdf/observable/subscribe", { ...params, skip1: value.current != undefined })
					return () => {
						subscription.unsubscribe()
						sendRequest(value.server, "vscode-vdf/observable/unsubscribe", params)
					}
				}).pipe(
					value.current != undefined ? startWith(value.current) : identity,
					shareReplay({ bufferSize: 1, refCount: true })
				)

				subjects.set(value.id, { subject: subject, ref: new WeakRef(observable) })
				registry.register(observable, JSON.stringify({ server: value.server, params: params } satisfies z.infer<typeof heldValueSchema>))
				return observable
			}
		})
	}

	return {
		input: {
			serialize: (object: any) => devalue.stringify(object, inputReducers),
			deserialize: (object: any) => devalue.parse(object, inputRevivers)
		},
		output: {
			serialize: (object: any) => devalue.stringify(object, outputReducers),
			deserialize: (object: any) => devalue.parse(object, outputRevivers)
		}
	}
}
