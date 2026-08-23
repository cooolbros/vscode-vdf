import { Observable, type OperatorFunction, type Subscription } from "rxjs"

export interface CombineLatestPersistentConfig<T, E extends { key: string }, O, R> {
	entries(value: T): E[]
	observableSelector(entry: E): Observable<O>
	resultSelector(value: T, results: O[]): R
}

export function combineLatestPersistent<T, E extends { key: string }, O, R>(config: CombineLatestPersistentConfig<T, E, O, R>): OperatorFunction<T, R> {
	return (source$: Observable<T>) => {
		return new Observable<R>((subscriber) => {
			const subscriptions = new Map<string, Subscription>()
			const map = new Map<string, O>()
			let current: T
			let entries: E[]

			const next = () => {
				if (entries.every((entry) => map.has(entry.key))) {
					const result = entries.map((entry) => map.get(entry.key)!)
					subscriber.next(config.resultSelector(current, result))
				}
			}

			const subscription = source$.subscribe((value) => {
				current = value
				entries = config.entries(value)

				for (const [key, subscription] of subscriptions) {
					if (!entries.some((entry) => entry.key == key)) {
						subscription.unsubscribe()
						subscriptions.delete(key)
						map.delete(key)
					}
				}

				for (const entry of entries) {
					subscriptions.getOrInsertComputed(entry.key, (key) => config.observableSelector(entry).subscribe((value) => {
						map.set(key, value)
						next()
					}))
				}

				next()
			})

			return () => {
				for (const subscription of subscriptions.values()) {
					subscription.unsubscribe()
				}
				subscription.unsubscribe()

				subscriptions.clear()
				map.clear()
			}
		})
	}
}
