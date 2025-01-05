import { defer, finalize, tap, type Observable } from "rxjs"

// https://github.com/ReactiveX/rxjs/issues/4803#issuecomment-496711335
export function finalizeWithValue<T>(callback: (value: T) => void) {
	return (source: Observable<T>) => defer(() => {
		let lastValue: T | undefined = undefined
		return source.pipe(
			tap((value) => lastValue = value),
			finalize(() => {
				if (lastValue != undefined) {
					callback(lastValue)
				}
			})
		)
	})
}
