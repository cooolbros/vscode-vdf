import { Observable, type Subscription } from "rxjs"

export function combineLatestPersistent<T>() {
	const subscriptions = new Map<Observable<any>, Subscription>()
	const values = { value: new Map<Observable<any>, { value?: T }>() }

	return (source: Observable<Observable<T>[]>) => {
		return new Observable<T[]>((subscriber) => {
			const subscription = source.subscribe((observables) => {

				for (const [observable, subscription] of subscriptions.entries().filter(([observable]) => !observables.includes(observable))) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}

				values.value = new Map(observables.values().map((v) => [v, {
					...((values.value.has(v) && "value" in values.value.get(v)!) && {
						value: values.value.get(v)!.value
					})
				}]))

				if (observables.length == 0) {
					subscriber.next([])
				}
				else {
					for (const observable of observables.values().filter((observable) => !subscriptions.has(observable))) {
						subscriptions.set(
							observable,
							observable.subscribe((value) => {
								values.value.get(observable)!.value = value
								if (values.value.values().every((v) => "value" in v)) {
									subscriber.next(values.value.values().map((v) => v.value!).toArray())
								}
							})
						)
					}
				}
			})

			return () => {
				for (const [observable, subscription] of subscriptions) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}
				subscription.unsubscribe()
				values.value.clear()
			}
		})
	}
}
