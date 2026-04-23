import { Observable } from "rxjs"

export function usingAsync<T extends AsyncDisposable>(
	resourceFactory: () => Promise<T>,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		const resourcePromise = resourceFactory()
		resourcePromise
			.then((resource) => {
				if (!subscriber.closed) {
					subscriber.next(resource)
				}
			})
			.catch((error) => {
				if (!subscriber.closed) {
					subscriber.error(error)
				}
			})

		return () => {
			resourcePromise
				.then((resource) => resource[Symbol.asyncDispose]())
				.catch(() => { })
		}
	})
}
