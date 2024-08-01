import { encodeBaseValue } from "utils/encodeBaseValue"
import { normalizeUri } from "utils/normalizeUri"
import type { DocumentLinkData } from "utils/types/DocumentLinkData"
import { Color, CompletionItem, CompletionItemKind, Diagnostic, DocumentLink, type Connection, type TextDocumentChangeEvent } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { VDFLanguageServer } from "../VDFLanguageServer"
import keys from "./keys.json"
import values from "./values.json"

export class VMTLanguageServer extends VDFLanguageServer {

	protected readonly name: Extract<VDFLanguageServer["name"], "VMT">
	protected readonly languageId: Extract<VDFLanguageServer["languageId"], "vmt">
	private readonly documentHUDRoots: Map<string, string | null>

	constructor(name: VMTLanguageServer["name"], languageId: VMTLanguageServer["languageId"], connection: Connection) {
		super(name, languageId, connection, {
			getVDFTokeniserOptions(uri) {
				return { allowMultilineStrings: false }
			},
			servers: new Set(),
			keyHash: (key) => key,
			schema: {
				keys: keys,
				values: values,
			},
			completion: {
				root: [
					{
						label: "LightmappedGeneric",
						kind: CompletionItemKind.Class
					},
					{
						label: "UnlitGeneric",
						kind: CompletionItemKind.Class
					},
					{
						label: "VertexlitGeneric",
						kind: CompletionItemKind.Class
					}
				]
			},
			definitionReferences: [],
			links: [
				{
					keys: new Set([
						"$baseTexture".toLowerCase()
					]),
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink | null> => {

						const hudRoot = this.documentHUDRoots.get(documentLink.data.uri)

						const value = `materials/${encodeBaseValue(documentLink.data.value.toLowerCase())}.vtf`

						if (hudRoot) {
							const hudUri = `${hudRoot}/${value}`
							if (await this.trpc.client.fileSystem.exists.query({ uri: hudUri })) {
								documentLink.target = hudUri
								return documentLink
							}
						}

						const tfUri = normalizeUri(`${this.documentsConfiguration.get(documentLink.data.uri).teamFortress2Folder}/tf/${value}`)
						if (await this.trpc.client.fileSystem.exists.query({ uri: tfUri })) {
							documentLink.target = tfUri
							return documentLink
						}

						const vpkUri = `vpk:///${value}?vpk=textures`
						if (await this.trpc.client.fileSystem.exists.query({ uri: vpkUri })) {
							documentLink.target = vpkUri
							return documentLink
						}

						return documentLink
					}
				}
			],

			// https://developer.valvesoftware.com/wiki/$color
			colours: [
				{
					parse: (value: string): Color | null => {
						if (/\[\s?[\d.]+\s+[\d.]+\s+[\d.]+\s?\]/.test(value)) {
							const colour = value.split(/[\s[\]]+/)
							return {
								red: parseFloat(colour[1]),
								green: parseFloat(colour[2]),
								blue: parseFloat(colour[3]),
								alpha: 1
							}
						}
						return null
					},
					stringify: (colour: Color): string => {
						return `[ ${colour.red.toFixed(2)} ${colour.green.toFixed(2)} ${colour.blue.toFixed(2)} ]`
					}
				},
				{
					parse: (value: string): Color | null => {
						if (/{\s?\d+\s+\d+\s+\d+\s?}/.test(value)) {
							const colour = value.split(/[\s{}]+/)
							return {
								red: parseInt(colour[1]) / 255,
								green: parseInt(colour[2]) / 255,
								blue: parseInt(colour[3]) / 255,
								alpha: 1
							}
						}
						return null
					},
					stringify: (colour: Color): string => {
						return `{ ${colour.red * 255} ${colour.green * 255} ${colour.blue * 255} }`
					}
				}
			],
		})

		this.name = name
		this.languageId = languageId
		this.documentHUDRoots = new Map<string, string | null>()
	}

	protected async onDidOpen(e: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		super.onDidOpen(e)

		const hudRoot = await this.trpc.client.searchForHUDRoot.query(e.document)
		this.documentHUDRoots.set(e.document.uri, hudRoot)
	}

	protected async validateDocumentSymbol(): Promise<Diagnostic | null> {
		return null
	}

	protected async getCompletionValues(uri: string, key: string, value: string): Promise<CompletionItem[] | null> {

		if (key == "$basetexture") {

			const hudRoot = this.documentHUDRoots.get(uri)

			return [
				...(
					hudRoot
						? await this.getFilesCompletion({ uri }, {
							uri: `${hudRoot}/materials`,
							relativePath: value,
							extensionsFilter: [".vtf"],
							displayExtensions: false
						})
						: []
				),
				...await this.getFilesCompletion({ uri }, {
					uri: "vpk:///materials",
					query: "?vpk=textures",
					relativePath: value,
					extensionsFilter: [".vtf"],
					displayExtensions: false
				})
			]
		}

		return null
	}
}
