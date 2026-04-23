import { Observable, Subscription } from "rxjs"
import type { Uri } from "../Uri"

export interface CombineLatestBaseFilesConfig<R> {
	stack: Stack
	open: (base: BaseValue) => Observable<BaseResult<R>>
}

export type Stack = { path: string, uri: Uri }[]

export interface BaseValue {
	stack: Stack
	detail: string
}

export const enum BaseResultType {
	None,
	Success,
	Error,
}

export type BaseResult<T> = (
	| { type: BaseResultType.None }
	| { type: BaseResultType.Success, ambient: boolean, value: T }
	| { type: BaseResultType.Error, self: string, errors: BaseError[] }
)

export const enum BaseErrorType {
	Self,
	Cyclic,
	Base,
}

export type BaseError = (
	| { type: BaseErrorType.Cyclic, stack: Stack }
	| { type: BaseErrorType.Self, self: string, detail: string, uri: Uri }
	| { type: BaseErrorType.Base, path: string, errors: BaseError[] }
)

export function combineLatestBaseFiles<T, R>(config: CombineLatestBaseFilesConfig<R>) {
	return (source$: Observable<{ base: string[], value: T }>) => {
		const { stack, open } = config
		const subscriptions = new Map<string, Subscription>()

		interface Current {
			value: T | undefined
			base: {
				details: string[]
				map: Map<string, { result: BaseResult<R> } | undefined>
			}
		}

		const current: Current = {
			value: undefined,
			base: { details: [], map: new Map() }
		}

		return new Observable<{ base: BaseResult<R>[], value: T }>((subscriber) => {

			function next() {
				if (current.base.map.values().every((value) => value?.result != undefined)) {
					subscriber.next({
						base: current.base.details.map((value) => current.base.map.get(value)!.result),
						value: current.value!,
					})
				}
			}

			const subscription = source$.subscribe(({ base, value }) => {
				current.value = value

				if (base.length == 0) {
					for (const subscription of subscriptions.values()) {
						subscription.unsubscribe()
					}
					subscriptions.clear()
					subscriber.next({
						base: [],
						value: current.value!
					})
				}
				else {
					current.base = {
						details: base,
						map: new Map(base.values().map((detail) => [detail, current.base.map.get(detail)]))
					}

					for (const [detail, subscription] of subscriptions.entries().filter(([detail]) => !base.includes(detail))) {
						subscription.unsubscribe()
						subscriptions.delete(detail)
					}

					for (const detail of base) {
						if (!subscriptions.has(detail)) {
							subscriptions.set(detail, open({ stack, detail }).subscribe((result) => {
								current.base.map.set(detail, { result })
								next()
							}))
						}
					}

					next()
				}
			})

			return () => {
				for (const subscription of subscriptions.values()) {
					subscription.unsubscribe()
				}
				subscription.unsubscribe()
				subscriptions.clear()
				current.base?.map.clear()
			}
		})
	}
}
