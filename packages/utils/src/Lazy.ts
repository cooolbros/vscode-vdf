export class Lazy<T> {

	private _factory?: () => NonNullable<T>
	private _value?: NonNullable<T>

	public get value(): NonNullable<T> {
		if (this._value != undefined) {
			return this._value
		}

		this._value = this._factory!()
		this._factory = undefined
		return this._value
	}

	constructor(factory: () => NonNullable<T>) {
		this._factory = factory
		this._value = undefined
	}
}
