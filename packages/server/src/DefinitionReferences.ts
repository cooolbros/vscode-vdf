import { Uri } from "common/Uri"
import { BehaviorSubject } from "rxjs"
import { VDFRange } from "vdf"
import { z, type ZodTypeAny } from "zod"

export class Collection<T> {

	public static readonly createSchema = <T extends ZodTypeAny>(schema: T) => z.map(z.number().nullable(), z.map(z.symbol(), z.map(z.string(), schema.array()))).transform((arg) => new Collection(arg))
	private readonly map: Map<number | null, Map<symbol, Map<string, T[]>>>

	public constructor(map: Map<number | null, Map<symbol, Map<string, T[]>>> = new Map()) {
		this.map = map
	}

	public get(scope: number | null, type: symbol, key: string) {
		return Object.freeze(this.map.get(scope)?.get(type)?.get(key.toLowerCase())) ?? null
	}

	public set(scope: number | null, type: symbol, key: string, ...value: T[]) {

		let scopeMap = this.map.get(scope)
		if (!scopeMap) {
			scopeMap = new Map()
			this.map.set(scope, scopeMap)
		}

		let typeMap = scopeMap.get(type)
		if (!typeMap) {
			typeMap = new Map()
			scopeMap.set(type, typeMap)
		}

		const keyLower = key.toLowerCase()

		let keyCollection = typeMap.get(keyLower)
		if (!keyCollection) {
			keyCollection = []
			typeMap.set(keyLower, keyCollection)
		}

		keyCollection.push(...value)
	}

	public ofType(scope: number | null, type: symbol): ReadonlyMap<string, T[]> {
		return this.map.get(scope)?.get(type) ?? new Map()
	}

	public *[Symbol.iterator](): Iterator<{ scope: number | null, type: symbol, key: string, value: T[] }> {
		for (const [scope, typeCollection] of this.map) {
			for (const [type, keyCollection] of typeCollection) {
				for (const [key, value] of keyCollection) {
					yield { scope, type, key, value }
				}
			}
		}
	}

	public toJSON() {
		return this.map
	}
}

export const definitionSchema = z.object({
	uri: Uri.schema,
	key: z.string(),
	range: VDFRange.schema,
	nameRange: VDFRange.schema.optional(),
	keyRange: VDFRange.schema,
	detail: z.string().optional(),
	conditional: z.string().optional(),
})

export type Definition = z.infer<typeof definitionSchema>

export class Definitions {

	public static readonly schema = z.object({
		collection: Collection.createSchema(definitionSchema)
	}).transform((arg) => new Definitions({ collection: arg.collection }))

	private readonly collection: Collection<Definition>
	private readonly globals: Definitions[]

	constructor({ collection = new Collection(), globals = [] }: { collection?: Collection<Definition>, globals?: Definitions[] } = {}) {
		this.collection = collection
		this.globals = globals
	}

	public get(scope: number | null, type: symbol, key: string): readonly Definition[] | null {
		const definitions = this.collection.get(scope, type, key)
		if (definitions != null) {
			return definitions
		}

		for (const global of this.globals) {
			const definitions = global.get(scope, type, key)
			if (definitions != null) {
				return definitions
			}
		}

		return null
	}

	public ofType(scope: number | null, type: symbol): ReadonlyMap<string, Definition[]> {

		const map = this.collection.ofType(scope, type)
		if (map.size) {
			return map
		}

		for (const definitions of this.globals) {
			const map = definitions.ofType(scope, type)
			if (map.size) {
				return map
			}
		}

		return new Map()
	}

	public [Symbol.iterator]() {
		return this.collection[Symbol.iterator]()
	}

	public toJSON() {
		return {
			collection: this.collection.toJSON()
		}
	}
}

export class References {

	public static readonly schema: z.ZodType<References, z.ZodTypeDef, any> = z.lazy(() => {
		return z.object({
			uri: Uri.schema,
			collection: Collection.createSchema(VDFRange.schema),
			dependencies: References.schema.array(),
			rest: z.map(z.string(), References.schema)
		}).transform((arg) => {
			return new References(arg.uri, arg.collection, arg.dependencies, arg.rest, new BehaviorSubject<void>(undefined))
		})
	})

	public readonly uri: Uri
	public readonly collection: Collection<VDFRange>
	private readonly dependencies: References[]

	public readonly rest: Map<string, References>
	public readonly references$: BehaviorSubject<void>

	constructor(
		uri: Uri,
		collection = new Collection<VDFRange>(),
		dependencies: References[],
		rest = new Map<string, References>(),
		references$ = new BehaviorSubject<void>(undefined)
	) {
		this.uri = uri
		this.collection = collection
		this.dependencies = dependencies
		this.rest = rest

		this.references$ = references$

		for (const dependency of this.dependencies) {
			dependency.setDocumentReferences(this.uri, this, false)
		}
	}

	public get(scope: number | null, type: symbol, key: string) {
		return this.collection.get(scope, type, key) ?? []
	}

	public [Symbol.iterator]() {
		return this.collection[Symbol.iterator]()
	}

	public setDocumentReferences(uri: Uri, references: References | null, notify: boolean) {
		if (references != null) {
			this.rest.set(uri.toString(), references)
		}
		else {
			this.rest.delete(uri.toString())
		}

		for (const dependency of this.dependencies) {
			dependency.setDocumentReferences(this.uri, this, notify)
		}

		if (notify) {
			this.references$.next()
		}
	}

	public *collect(scope: number | null, type: symbol, key: string) {
		function* walk(references: References): Generator<{ uri: Uri, range: VDFRange }> {
			for (const range of references.get(scope, type, key)) {
				yield { uri: references.uri, range: range }
			}

			for (const dependency of references.rest.values()) {
				yield* dependency.collect(scope, type, key)
			}
		}

		yield* walk(this)
	}

	public toJSON() {
		return {
			uri: this.uri,
			collection: this.collection.toJSON(),
			dependencies: this.dependencies,
			rest: this.rest
		}
	}
}

export class DefinitionReferences {

	public readonly scopes: Map<symbol, Map<number, VDFRange>>
	public readonly definitions: Definitions
	public readonly references: References

	constructor(scopes: Map<symbol, Map<number, VDFRange>>, definitions: Definitions, references: References) {
		this.scopes = scopes
		this.definitions = definitions
		this.references = references
	}
}
