import { Observable, type Subscription } from "rxjs"

export function combineLatestPersistent<T extends { key: string }, R>(observableSelector: (value: T) => Observable<R>) {
	const subscriptions = new Map<string, Subscription>()
	let map = new Map<string, R | undefined>()
	return (source$: Observable<T[]>) => {
		return new Observable<R[]>((subscriber) => {
			const subscription = source$.subscribe((entries) => {

				for (const [observable, subscription] of subscriptions.entries().filter(([key]) => !entries.some((entry) => entry.key == key))) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}

				map = new Map(entries.values().map((entry) => [entry.key, map.get(entry.key)]))

				if (entries.length == 0) {
					subscriber.next([])
				}
				else {
					for (const entry of entries) {
						subscriptions.getOrInsertComputed(entry.key, () => observableSelector(entry).subscribe((value) => {
							map.set(entry.key, value)
							if (map.values().every((value) => value != undefined)) {
								subscriber.next(map.values().toArray() as R[])
							}
						}))
					}
				}
			})

			return () => {
				for (const [observable, subscription] of subscriptions) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}
				subscription.unsubscribe()
				map.clear()
			}
		})
	}
}
