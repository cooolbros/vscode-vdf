import { Uri } from "common/Uri"
import { BehaviorSubject } from "rxjs"
import { VDFRange } from "vdf"
import { CompletionItem, MarkupKind, type CompletionItemKind } from "vscode-languageserver"
import { z } from "zod"

export class Collection<T> {

	public static readonly createSchema = <T extends z.ZodType>(schema: T) => z.map(
		z.number().nullable(),
		z.map(
			z.symbol(),
			z.map(
				z.string(),
				z.array(schema)
			)
		)
	).transform((arg) => new Collection(arg))
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

	public clone() {
		// structuredClone does not support Symbols
		return new Collection<T>(new Map(this.map.entries().map(([scope, map]) => <const>[scope, new Map(map.entries().map(([type, map]) => <const>[type, new Map(map.entries().map(([key, value]) => <const>[key, [...value]]))]))])))
	}

	public toJSON() {
		return this.map
	}
}

export const definitionSchema = z.object({
	uri: Uri.schema,
	key: z.string(),
	range: VDFRange.schema,
	keyRange: VDFRange.schema,
	nameRange: VDFRange.schema.optional(),
	detail: z.string().optional(),
	documentation: z.string().optional(),
	conditional: z.templateLiteral(["[", z.string(), "]"]).optional(),
	completionItem: z.object({
		labelDetails: z.object({
			detail: z.string().optional(),
			description: z.string().optional()
		}).optional(),
		kind: z.number().min(1).max(25).transform((arg) => <CompletionItemKind>arg).optional(),
		documentation: z.union([
			z.string(),
			z.object({
				kind: z.enum([MarkupKind.PlainText, MarkupKind.Markdown]),
				value: z.string()
			})
		]).optional(),
		filterText: z.string().optional(),
		insertText: z.string().optional(),
		data: z.any().optional(),
	}).optional(),
})

CompletionItem

export type Definition = Readonly<z.infer<typeof definitionSchema>>

export class Definitions {

	public static readonly schema = z.object({
		version: z.array(z.number()),
		collection: Collection.createSchema(definitionSchema)
	}).transform((arg) => new Definitions({ version: arg.version, collection: arg.collection }))

	public readonly version: number[]
	private readonly collection: Collection<Definition>
	private readonly globals: Definitions[]

	constructor({ version, collection = new Collection(), globals = [] }: { version: number[], collection?: Collection<Definition>, globals?: Definitions[] }) {
		this.version = version
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
			version: this.version,
			collection: this.collection.toJSON()
		}
	}
}

export class References {

	public static readonly schema: z.ZodType<References> = z.object({
		uri: Uri.schema,
		collection: Collection.createSchema(VDFRange.schema),
		get dependencies() {
			return z.array(References.schema)
		},
		get references() {
			return z.map(z.string(), References.schema)
		}
	}).transform((arg) => {
		return new References(arg.uri, arg.collection, arg.dependencies, new BehaviorSubject(arg.references))
	})

	public readonly uri: Uri
	public readonly collection: Collection<VDFRange>
	private readonly dependencies: References[]

	public readonly references$: BehaviorSubject<Map<string, References>>

	constructor(
		uri: Uri,
		collection = new Collection<VDFRange>(),
		dependencies: References[],
		references$ = new BehaviorSubject(new Map<string, References>())
	) {
		this.uri = uri
		this.collection = collection
		this.dependencies = dependencies
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
			this.references$.value.set(uri.toString(), references)
		}
		else {
			this.references$.value.delete(uri.toString())
		}

		for (const dependency of this.dependencies) {
			dependency.setDocumentReferences(this.uri, this, notify)
		}

		if (notify) {
			this.references$.next(this.references$.value)
		}
	}

	public *collect(scope: number | null, type: symbol, key: string) {
		function* walk(references: References): Generator<{ uri: Uri, range: VDFRange }> {
			for (const range of references.get(scope, type, key)) {
				yield { uri: references.uri, range: range }
			}

			for (const dependency of references.references$.value.values()) {
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
			references: this.references$.value
		}
	}
}

export interface DefinitionReferences {
	readonly scopes: Map<symbol, Map<number, VDFRange>>
	readonly definitions: Definitions
	readonly references: References
}
