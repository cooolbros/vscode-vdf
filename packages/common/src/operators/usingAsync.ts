import { Observable } from "rxjs"

export function usingAsync<T extends AsyncDisposable>(
	resourceFactory: () => Promise<T>,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		const resourcePromise = resourceFactory()
		resourcePromise.then((resource) => subscriber.next(resource))

		return () => {
			resourcePromise.then((resource) => resource[Symbol.asyncDispose]())
		}
	})
}
