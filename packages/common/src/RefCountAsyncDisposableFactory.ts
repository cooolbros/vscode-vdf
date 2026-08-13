export class RefCountAsyncDisposableFactory<TKey, TValue extends AsyncDisposable> {

	private static id = 0

	protected readonly map: Map<string, { count: number, value: Promise<TValue> }>
	private readonly registry: FinalizationRegistry<string>
	private readonly set: Set<number>

	constructor(private readonly keyHash: (key: TKey) => string, private readonly factory: (key: TKey, factory: RefCountAsyncDisposableFactory<TKey, TValue>) => Promise<TValue>) {
		this.map = new Map()
		this.set = new Set<number>()

		this.registry = new FinalizationRegistry<string>((held) => {
			const { id, stack } = JSON.parse(held)
			if (this.set.has(id)) {
				console.warn(`[FinalizationRegistry]`)
				console.warn(stack)
			}
			this.set.delete(id)
		})
	}

	public async get(key: TKey, factory = this.factory): Promise<TValue> {
		const k = this.keyHash(key)

		const value = this.map.getOrInsertComputed(k, () => ({
			count: 0,
			value: factory(key, this)
		}))

		const target = await value.value

		const id = RefCountAsyncDisposableFactory.id++
		const stack = new Error(`${target.constructor.name}(${k})`).stack!
		const held = JSON.stringify({ id, stack })

		const proxy = new Proxy(target, {
			get: (target, p, receiver) => {
				if (!this.set.has(id)) {
					console.warn(`[Symbol.asyncDispose]() => ${target.constructor.name}(${k}).${String(p)}`)
					console.warn(stack)
				}

				if (p != Symbol.asyncDispose) {
					return Reflect.get(target, p, receiver)
				}
				else {
					return async () => {
						if (!this.set.has(id)) {
							console.warn(`[Symbol.asyncDispose]() => ${target.constructor.name}(${k})[Symbol.asyncDispose]()`)
							console.warn(stack)
						}

						value.count--
						this.registry.unregister(proxy)
						this.set.delete(id)

						if (value.count == 0) {
							this.map.delete(k)
							await target[Symbol.asyncDispose]()
						}
					}
				}
			}
		})

		this.registry.register(proxy, held)
		this.set.add(id)

		value.count++
		return proxy as any
	}
}
