export class RefCountAsyncDisposableFactory<TKey, TValue extends AsyncDisposable | Disposable> {

	protected readonly map: Map<string, { count: { value: number }, value: Promise<TValue> }>

	constructor(private readonly keyHash: (key: TKey) => string, private readonly factory: (key: TKey, factory: RefCountAsyncDisposableFactory<TKey, TValue>) => Promise<TValue>) {
		this.map = new Map()
	}

	public async get(key: TKey, factory = this.factory): Promise<TValue> {
		const k = this.keyHash(key)
		if (!this.map.has(k)) {
			const count = { value: 0 }
			this.map.set(k, {
				count: count,
				value: factory(key, this).then((target) => {
					return new Proxy(target, {
						get: (target, p, receiver) => {
							if (p != Symbol.asyncDispose) {
								return Reflect.get(target, p, receiver)
							}
							else {
								return async () => {
									count.value--
									if (count.value == 0) {
										this.map.delete(k)
										if (Symbol.asyncDispose in target) {
											await target[Symbol.asyncDispose]()
										}
										else {
											target[Symbol.dispose]()
										}
									}
								}
							}
						},
					})
				})
			})
		}

		const value = this.map.get(k)!
		value.count.value++
		return value.value
	}
}
