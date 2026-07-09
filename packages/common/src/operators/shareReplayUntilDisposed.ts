import { ReplaySubject, share } from "rxjs"

export const shareReplayUntilDisposed = <T>(dispose$: ReplaySubject<void>) => share<T>({
	connector: () => new ReplaySubject(1),
	resetOnRefCountZero: () => dispose$,
})
