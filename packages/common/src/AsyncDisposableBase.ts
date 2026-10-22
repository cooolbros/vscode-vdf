import { ReplaySubject, type Observable } from "rxjs"

export abstract class AsyncDisposableBase implements AsyncDisposable {

	protected readonly stack: AsyncDisposableStack
	public readonly dispose$: Observable<void>

	public constructor() {
		const stack = new AsyncDisposableStack()

		const dispose$ = new ReplaySubject<void>(1)
		this.dispose$ = dispose$.asObservable()
		stack.defer(() => dispose$.next())

		this.stack = stack
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.stack.disposeAsync()
	}
}
