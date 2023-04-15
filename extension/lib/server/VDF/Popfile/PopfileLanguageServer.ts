import type { DocumentLinkData } from "$lib/types/DocumentLinkData"
import { decimalToHexadecimal, hexadecimalToDecimal, hexadecimalToRgb, rgbToHexadecimal } from "$lib/utils/colours"
import { Color, CompletionItem, CompletionItemKind, Connection, Diagnostic, DocumentLink } from "vscode-languageserver"
import { VDFLanguageServer } from "../VDFLanguageServer"
import keys from "./keys.json"
import values from "./values.json"

export class PopfileLanguageServer extends VDFLanguageServer {

	protected readonly name: Extract<VDFLanguageServer["name"], "Popfile">
	protected readonly languageId: Extract<VDFLanguageServer["languageId"], "popfile">

	constructor(name: PopfileLanguageServer["name"], languageId: PopfileLanguageServer["languageId"], connection: Connection) {
		super(name, languageId, connection, {
			vpkRootPath: "scripts/population",
			keyHash: (key) => key,
			schema: {
				keys: keys,
				values: values
			},
			completion: {
				root: [
					{
						label: "WaveSchedule",
						kind: CompletionItemKind.Class
					}
				],
				files: [
					"robot_standard.pop",
					"robot_giant.pop",
					"robot_gatebot.pop",
				]
			},
			definitionReferences: [
				{
					parentKeys: [
						"Templates".toLowerCase()
					],
					referenceKeys: new Set([
						"Template".toLowerCase()
					])
				},
				{
					parentKeys: [
						"Wave".toLowerCase(),
					],
					definitionIDKey: "name",
					definitionChildren: true,
					referenceKeys: new Set([
						"WaitForAllSpawned".toLowerCase(),
						"WaitForAllDead".toLowerCase()
					])
				}
			],
			links: [
				{
					keys: new Set([
						"ClassIcon".toLowerCase()
					]),
					resolve: async (documentLink: DocumentLinkData): Promise<DocumentLink> => {

						const relativePath = `materials/hud/leaderboard_class_${documentLink.data.value.toLowerCase()}.vmt`

						const teamFortress2DirectoryUri = `file:///${this.documentsConfiguration.get(documentLink.data.uri).teamFortress2Folder}`

						const customDirectory = `${teamFortress2DirectoryUri}/tf/custom`

						for (const [item, type] of await this.fileSystem.readDirectory(customDirectory)) {
							if (type == 2) {
								const vmtPath = `${customDirectory}/${item}/${relativePath}`
								if (await this.fileSystem.exists(vmtPath)) {
									documentLink.target = vmtPath
									return documentLink
								}
							}
						}

						const vpkVmtPath = `vpk:///${relativePath}?vpk=misc`
						if (await this.fileSystem.exists(vpkVmtPath)) {
							documentLink.target = vpkVmtPath
							return documentLink
						}

						const tfPath = `${teamFortress2DirectoryUri}/tf/${relativePath}`
						if (await this.fileSystem.exists(tfPath)) {
							documentLink.target = tfPath
							return documentLink
						}

						const downloadPath = `${teamFortress2DirectoryUri}/tf/download/${relativePath}`
						if (await this.fileSystem.exists(downloadPath)) {
							documentLink.target = downloadPath
							return documentLink
						}

						return documentLink
					}
				}
			],
			colours: [
				{
					keys: new Set([
						"set item tint rgb"
					]),
					parse: (value: string): Color | null => {
						const [r, g, b] = hexadecimalToRgb(decimalToHexadecimal(parseInt(value)))
						return {
							red: r / 255,
							green: g / 255,
							blue: b / 255,
							alpha: 255
						}
					},
					stringify: (colour: Color): string => {
						return hexadecimalToDecimal(rgbToHexadecimal(colour.red * 255, colour.green * 255, colour.blue * 255)).toString()
					}
				}
			]
		})

		this.name = name
		this.languageId = languageId
	}

	protected async validateDocumentSymbol(): Promise<Diagnostic | null> {
		return null
	}

	protected async getCompletionValues(uri: string, key: string): Promise<CompletionItem[] | null> {
		return null
	}
}
