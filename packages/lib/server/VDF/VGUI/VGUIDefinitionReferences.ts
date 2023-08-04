import { DocumentDefinitionReferences } from "lib/utils/definitionReferences"
import type { VGUIDefinitionReferencesConfiguration, VGUIDefinitionType } from "./VGUILanguageServer"

export type DefinitionFile = {
	configurations: VGUIDefinitionReferencesConfiguration[]
	definitionTypeEntryFileUri: string
	allowMultilineStrings: boolean,
	uri: string
	fileDefinitionTypes: Set<VGUIDefinitionType>
}

export class VGUIDefinitionReferences extends DocumentDefinitionReferences {

	// You must be able to:
	// Get only types of definitions in a single file (Find references)
	// Get all the types that a definition file could declare (OnDidChangeContent and invalidate scheme)
	// Delete all file uris that could contain a type

	public readonly hudRoot: string

	private definitionFiles: DefinitionFile[]

	constructor(hudRoot: string, size: number) {
		super(size)
		this.hudRoot = hudRoot
		this.definitionFiles = []
	}

	public addDefinitionFile(configurations: VGUIDefinitionReferencesConfiguration[], definitionTypeEntryFileUri: string, allowMultilineStrings: boolean, uri: string, type?: VGUIDefinitionType): void {

		for (const definitionFile of this.definitionFiles) {
			if (definitionFile.uri == uri) {
				if (type != undefined) {
					definitionFile.fileDefinitionTypes.add(type)
				}
				return
			}
		}

		this.definitionFiles.push({
			configurations,
			definitionTypeEntryFileUri,
			allowMultilineStrings,
			uri,
			fileDefinitionTypes: new Set<VGUIDefinitionType>(type ? [type] : [])
		})
	}

	public getDefinitionFile(uri: string): DefinitionFile | undefined {
		for (const definitionFile of this.definitionFiles) {
			if (definitionFile.uri == uri) {
				return definitionFile
			}
		}
	}

	public deleteDefinitionFilesOfTypes(types: Set<VGUIDefinitionType>): void {
		this.definitionFiles = this.definitionFiles.filter((i) => i.configurations.some(j => types.has(j.type)))
	}
}
