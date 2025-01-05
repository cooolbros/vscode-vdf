import { Observable, of } from "rxjs"

export function usingAsync<T extends Disposable>(
	resourceFactory: () => Promise<T>,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		const resourcePromise = resourceFactory()
		const subscriptionPromise = resourcePromise.then((resource) => of(resource).subscribe(subscriber))

		return () => {
			resourcePromise.then((resource) => resource[Symbol.dispose]())
			subscriptionPromise.then((subscription) => subscription.unsubscribe())
		}
	})
}
