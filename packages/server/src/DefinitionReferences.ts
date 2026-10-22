import { Uri } from "common/Uri"
import { BehaviorSubject, combineLatest, map, shareReplay, type Observable } from "rxjs"
import { VDFRange } from "vdf"
import type { VDFText } from "vdf-documentsymbols"
import { type InlayHintLabelPart, type MarkupContent } from "vscode-languageserver"
import type { DefinitionType } from "./DefinitionTypes"
import type { VDFCompletionItem } from "./TextDocumentBase"

export class Collection<T> {

	private readonly map: Map<number | null, Map<DefinitionType, Map<string, T[]>>>

	public constructor(map = new Map<number | null, Map<DefinitionType, Map<string, T[]>>>()) {
		this.map = map
	}

	public ofScope(scope: number | null): ReadonlyMap<DefinitionType, ReadonlyMap<string, T[]>> {
		return this.map.get(scope) ?? new Map()
	}

	public ofType(scope: number | null, type: DefinitionType): ReadonlyMap<string, T[]> {
		return this.map.get(scope)?.get(type) ?? new Map()
	}

	public get(scope: number | null, type: DefinitionType, key: string) {
		return Object.freeze(this.map.get(scope)?.get(type)?.get(key.toLowerCase())) ?? null
	}

	public set(scope: number | null, type: DefinitionType, key: string, ...value: T[]) {
		this.map
			.getOrInsertComputed(scope, () => new Map())
			.getOrInsertComputed(type, () => new Map())
			.getOrInsertComputed(key.toLowerCase(), () => [])
			.push(...value)
	}

	public *[Symbol.iterator](): Iterator<{ scope: number | null, type: DefinitionType, key: string, value: T[] }> {
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
}

export interface Definition {
	readonly uri: Uri
	readonly key: string
	readonly range: VDFRange
	readonly keyToken: VDFText
	readonly nameToken?: VDFText
	readonly detail?: string
	readonly documentation?: MarkupContent
	readonly conditional?: `[${string}]`
	readonly inlayHintLabel?: InlayHintLabelPart
	readonly completionItem: VDFCompletionItem
	readonly data?: any
}

export class Definitions {

	public readonly version: number[]
	public readonly collection: Collection<Definition>

	public constructor(version: number[], collection: Collection<Definition>) {
		this.version = version
		this.collection = collection
	}

	public ofScope(scope: number | null): ReadonlyMap<DefinitionType, ReadonlyMap<string, ReadonlyArray<Definition>>> {
		return this.collection.ofScope(scope)
	}

	public ofType(scope: number | null, type: DefinitionType): ReadonlyMap<string, ReadonlyArray<Definition>> {
		return this.collection.ofType(scope, type)
	}

	public get(scope: number | null, type: DefinitionType, key: string): ReadonlyArray<Definition> | null {
		return this.collection.get(scope, type, key)
	}

	public [Symbol.iterator]() {
		return this.collection[Symbol.iterator]()
	}
}

export interface SetDocumentReferences {
	setDocumentReferences(references: Map<string /* Uri */, References | null>, notify: boolean): void
}

export class References {

	public readonly uri: Uri
	public readonly collection$: BehaviorSubject<Collection<VDFText>>
	public readonly references$: BehaviorSubject<Map<string /* Uri */, References>>
	public readonly next$: Observable<void>

	public constructor(
		uri: Uri,
		collection$: BehaviorSubject<Collection<VDFText>>,
		references$: BehaviorSubject<Map<string, References>>,
	) {
		this.uri = uri
		this.collection$ = collection$
		this.references$ = references$
		this.next$ = combineLatest([this.collection$, this.references$]).pipe(
			map(() => undefined),
			shareReplay({ bufferSize: 1, refCount: true })
		)
	}

	public *collect(scope: number | null, type: DefinitionType, key: string): Generator<{ uri: Uri, reference: VDFText }> {
		const seen = new Set<string>()

		function* walk(references: References): Generator<{ uri: Uri, reference: VDFText }> {
			// Skip already seen uris, this happens in 2 places
			// 1. resource/clientscheme.res's #base files add references to global clientscheme, so that definitions can be referenced before they are defined
			// 2. scripts/hudanimations_manifest.txt's HUD animations files add references to all HUD animations manifest files through scripts/hudanimations_manifest.txt
			const uri = references.uri.toString()
			if (seen.has(uri)) {
				return
			}
			seen.add(uri)

			for (const reference of references.collection$.value.get(scope, type, key) ?? []) {
				yield { uri: references.uri, reference: reference }
			}

			for (const dependency of references.references$.value.values()) {
				yield* walk(dependency)
			}
		}

		yield* walk(this)
	}

	public detach(): References {
		const references$ = new BehaviorSubject(new Map())
		this.collection$.subscribe({ complete: () => references$.complete() })
		return new References(this.uri, this.collection$, references$)
	}
}

export interface DefinitionReferences {
	readonly scopes: Map<DefinitionType, Map<number, VDFRange[]>>
	readonly definitions: Collection<Definition>
	readonly references: Collection<VDFText>
}
