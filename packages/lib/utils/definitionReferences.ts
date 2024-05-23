import type { VDFDefinitionReferencesConfiguration, VDFLanguageServerConfiguration } from "../server/VDF/VDFLanguageServerConfiguration"
import type { VDFRange } from "../VDF/VDFRange"
import type { VDFDocumentSymbol } from "../VDFDocumentSymbols/VDFDocumentSymbol"
import { ArrayContainsArray } from "./ArrayContainsArray"

export type DocumentsDefinitionReferences = Map<string, DocumentDefinitionReferences>

export class DocumentDefinitionReferences {

	public readonly size: number
	protected readonly documentDefinitionReferences: Map<number, Map<string, DefinitionReference>>

	constructor(size: number) {
		this.size = size
		this.documentDefinitionReferences = new Map<number, Map<string, DefinitionReference>>()

		for (let i = 0; i < size; i++) {
			this.documentDefinitionReferences.set(i, new Map<string, DefinitionReference>())
		}
	}

	public ofType(type: number): Map<string, DefinitionReference> {
		if (type < 0 || type > this.size) {
			throw new TypeError(`Invalid type ${type}.`)
		}
		return this.documentDefinitionReferences.get(type)!
	}

	public get([type, key]: [number, string]): DefinitionReference {

		const keyLower = key.toLowerCase()

		const typeDefinitionReferences = this.documentDefinitionReferences.get(type)!
		if (typeDefinitionReferences.has(keyLower)) {
			return typeDefinitionReferences.get(keyLower)!
		}

		const value = new DefinitionReference([type, key])
		typeDefinitionReferences.set(keyLower, value)

		return value
	}

	public deleteDefinitions(): void {
		for (const [, typeDefinitionReferences] of this.documentDefinitionReferences) {
			for (const [key, definitionReference] of typeDefinitionReferences) {
				definitionReference.deleteDefinitionLocation()
				if (!definitionReference.hasReferences()) {
					typeDefinitionReferences.delete(key)
				}
			}
		}
	}

	public deleteDefinitionsOfTypes(types: Set<number>): void {
		for (const type of types) {
			for (const definitionReference of this.ofType(type).values()) {
				definitionReference.deleteDefinitionLocation()
			}
		}
	}

	public deleteReferences(uri: string): void {
		for (const [, definitionReferences] of this.documentDefinitionReferences) {
			for (const [, definitionReference] of definitionReferences) {
				definitionReference.deleteReferences(uri)
			}
		}
	}

	public *[Symbol.iterator](): Iterator<readonly [number, string, DefinitionReference]> {
		for (const [index, definitionReferences] of this.documentDefinitionReferences) {
			for (const [key, definitionReference] of definitionReferences) {
				yield [index, key, definitionReference]
			}
		}
	}
}

export class DefinitionReference {

	public readonly type: number
	public readonly key: string
	private definitionLocation?: DefinitionLocation
	private definitionIDLocation?: DefinitionLocation
	private value?: any
	private readonly references: Map<string, VDFRange[]>

	constructor([index, key]: [number, string]) {
		this.type = index
		this.key = key
		this.definitionLocation = undefined
		this.references = new Map<string, VDFRange[]>()
	}

	// #region Definition

	public getDefinitionLocation(): DefinitionLocation | undefined {
		return this.definitionLocation
	}

	public getDefinitionIDLocation(): DefinitionLocation | undefined {
		return this.definitionIDLocation
	}

	public setDefinitionLocation({ definitionLocation, definitionIDLocation, value }: { definitionLocation: DefinitionLocation, definitionIDLocation?: DefinitionLocation, value: any }): void {
		if (this.definitionLocation != undefined) {
			throw new Error(`[${this.type}, ${this.key}] Definition location already set`)
		}
		this.definitionLocation = definitionLocation
		this.definitionIDLocation = definitionIDLocation
		this.value = value
	}

	public deleteDefinitionLocation(): void {
		this.definitionLocation = undefined
		this.definitionIDLocation = undefined
	}

	public hasValue(): boolean {
		return this.value != undefined
	}

	public getValue(): any {
		if (this.value == undefined) {
			throw new Error(`[${this.type}, ${this.key}] Definition value is undefined`)
		}
		return this.value
	}

	// #endregion

	// #region References

	public hasReferences(): boolean {

		if (this.references.size == 0) {
			return false
		}

		for (const ranges of this.references.values()) {
			if (ranges.length > 0) {
				return true
			}
		}

		return false
	}

	public *getReferences(): Iterable<{ uri: string, range: VDFRange }> {
		for (const [uri, ranges] of this.references) {
			for (const range of ranges) {
				yield { uri, range }
			}
		}
	}

	public addReference(uri: string, range: VDFRange): void {
		if (!this.references.has(uri)) {
			this.references.set(uri, [])
		}
		this.references.get(uri)!.push(range)
	}

	public deleteReferences(uri: string): void {
		this.references.delete(uri)
	}

	// #endregion
}

export type DefinitionLocation = { uri: string, range: VDFRange }

/**
 * @returns The key of the definition if the documentSymbol matches, or null
 */
export function documentSymbolMatchesDefinition(
	definitionReference: VDFDefinitionReferencesConfiguration,
	documentSymbol: VDFDocumentSymbol,
	objectPath: string[]
): string | null {

	const parentKeysTrue = ArrayContainsArray(objectPath, definitionReference.parentKeys)

	const definitionKey = definitionReference.definitionIDKey != undefined
		? documentSymbol.children?.find((i) => i.key.toLowerCase() == definitionReference.definitionIDKey && i.detail != undefined)?.detail
		: documentSymbol.key

	const definitionKeyTrue = definitionKey != undefined

	const definitionChildrenTrue = definitionReference.definitionChildren ? documentSymbol.children != undefined : true

	if (parentKeysTrue && definitionKeyTrue && definitionChildrenTrue) {
		return definitionKey
	}

	return null
}

export function documentSymbolMatchesReferences(
	definitionReference: VDFLanguageServerConfiguration["definitionReferences"][number],
	key: string,
): boolean {
	return definitionReference.referenceKeys.has(key.toLowerCase())
}
