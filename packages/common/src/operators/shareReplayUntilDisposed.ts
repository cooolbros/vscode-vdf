import { ReplaySubject, share, shareReplay, take, type Observable } from "rxjs"

export const shareReplayUntilDisposed = <T>(dispose$: Observable<void>) => {

	const replaySubject$ = dispose$.pipe(
		take(1),
		shareReplay(1)
	)

	return share<T>({
		connector: () => new ReplaySubject(1),
		resetOnRefCountZero: () => replaySubject$,
	})
}
