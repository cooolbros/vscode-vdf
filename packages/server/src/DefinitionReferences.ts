import { Uri } from "common/Uri"
import { BehaviorSubject } from "rxjs"
import { VDFRange } from "vdf"
import { z, type ZodTypeAny } from "zod"

class Collection<T> {

	public static readonly createSchema = <T extends ZodTypeAny>(schema: T) => z.map(z.symbol(), z.map(z.string(), schema.array())).transform((arg) => new Collection([arg]))
	private readonly map: Map<symbol, Map<string, T[]>>

	public constructor(init?: Map<symbol, Map<string, T[]>>[]) {
		this.map = new Map(init ? init?.values().flatMap((map) => map) : [])
	}

	public get(type: symbol, key: string) {
		return Object.freeze(this.map.get(type)?.get(key.toLowerCase())) ?? null
	}

	public set(type: symbol, key: string, ...value: T[]) {

		let typeMap = this.map.get(type)
		if (!typeMap) {
			typeMap = new Map()
			this.map.set(type, typeMap)
		}

		const keyLower = key.toLowerCase()

		let keyCollection = typeMap.get(keyLower)
		if (!keyCollection) {
			keyCollection = []
			typeMap.set(keyLower, keyCollection)
		}

		keyCollection.push(...value)
	}

	public ofType(type: symbol): ReadonlyMap<string, T[]> {
		return this.map.get(type) ?? new Map()
	}

	public *[Symbol.iterator](): Iterator<{ type: symbol, key: string, value: T[] }> {
		for (const [type, keyCollection] of this.map) {
			for (const [key, value] of keyCollection) {
				yield { type, key, value }
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

	public get(type: symbol, key: string): readonly Definition[] | null {
		const definitions = this.collection.get(type, key)
		if (definitions != null) {
			return definitions
		}

		for (const global of this.globals) {
			const definitions = global.get(type, key)
			if (definitions != null) {
				return definitions
			}
		}

		return null
	}

	public add(type: symbol, key: string, ...definitions: Definition[]) {
		this.collection.set(type, key, ...definitions)
	}

	public ofType(type: symbol): ReadonlyMap<string, Definition[]> {

		const map = this.collection.ofType(type)
		if (map.size) {
			return map
		}

		for (const definitions of this.globals) {
			const map = definitions.ofType(type)
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

	public static readonly schema = z.object({
		uri: Uri.schema,
		collection: Collection.createSchema(VDFRange.schema),
	}).transform((arg) => {
		return new References(arg.uri, arg.collection)
	})

	public readonly uri: Uri
	private readonly collection: Collection<VDFRange>

	constructor(uri: Uri, collection = new Collection<VDFRange>()) {
		this.uri = uri
		this.collection = collection
	}

	public get(type: symbol, key: string) {
		return this.collection.get(type, key) ?? []
	}

	public [Symbol.iterator]() {
		return this.collection[Symbol.iterator]()
	}

	public addReference(type: symbol, key: string, range: VDFRange) {
		this.collection.set(type, key, range)
	}

	public toJSON() {
		return {
			uri: this.uri.toJSON(),
			collection: this.collection.toJSON(),
		}
	}
}

export class DefinitionReferences {

	private readonly dependencies: DefinitionReferences[]
	public readonly definitions: Definitions
	public readonly references: Map<string /* Uri */, References>
	public readonly references$: BehaviorSubject<void>

	constructor({ dependencies = [], globals = [] }: { dependencies?: DefinitionReferences[], globals?: Definitions[] } = {}) {
		this.dependencies = dependencies
		this.definitions = new Definitions({ globals })

		this.references = new Map()
		this.references$ = new BehaviorSubject<void>(undefined)
	}

	public setDocumentReferences(references: References[], notify: boolean) {

		for (const documentReferences of references) {
			this.references.set(documentReferences.uri.toString(), documentReferences)
		}

		for (const dependency of this.dependencies) {
			dependency.setDocumentReferences(references, notify)
		}

		if (notify) {
			this.references$.next()
		}
	}
}
