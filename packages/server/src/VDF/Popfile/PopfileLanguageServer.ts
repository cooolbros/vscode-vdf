import type { CombinedDataTransformer, initTRPC } from "@trpc/server"
import { posix } from "path"
import type { DocumentLinkData } from "utils/types/DocumentLinkData"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { Color, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentLink, type Connection } from "vscode-languageserver"
import { VDFLanguageServer } from "../VDFLanguageServer"
import keys from "./keys.json"
import values from "./values.json"

export class PopfileLanguageServer extends VDFLanguageServer {

	protected readonly languageId: Extract<VDFLanguageServer["languageId"], "popfile">
	protected readonly name: Extract<VDFLanguageServer["name"], "Popfile">
	private vscript = false

	constructor(languageId: PopfileLanguageServer["languageId"], name: PopfileLanguageServer["name"], connection: Connection) {
		super(languageId, name, connection, {
			getVDFTokeniserOptions(uri) {
				return { allowMultilineStrings: true }
			},
			servers: new Set(),
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
					name: "template",
					parentKeys: [
						"Templates".toLowerCase()
					],
					referenceKeys: new Set([
						"Template".toLowerCase()
					])
				},
				{
					name: "wavespawn",
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

						for (const [item, type] of await this.trpc.client.fileSystem.readDirectory.query({ uri: customDirectory })) {
							if (type == 2) {
								const vmtPath = `${customDirectory}/${item}/${relativePath}`
								if (await this.trpc.client.fileSystem.exists.query({ uri: vmtPath })) {
									documentLink.target = vmtPath
									return documentLink
								}
							}
						}

						const vpkVmtPath = `vpk:///${relativePath}?vpk=misc`
						if (await this.trpc.client.fileSystem.exists.query({ uri: vpkVmtPath })) {
							documentLink.target = vpkVmtPath
							return documentLink
						}

						const tfPath = `${teamFortress2DirectoryUri}/tf/${relativePath}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: tfPath })) {
							documentLink.target = tfPath
							return documentLink
						}

						const downloadPath = `${teamFortress2DirectoryUri}/tf/download/${relativePath}`
						if (await this.trpc.client.fileSystem.exists.query({ uri: downloadPath })) {
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
						const colour = parseInt(value)
						return {
							red: ((colour >> 16) & 255) / 255,
							green: ((colour >> 8) & 255) / 255,
							blue: ((colour >> 0) & 255) / 255,
							alpha: 255
						}
					},
					stringify: (colour: Color): string => {
						return (colour.red * 255 << 16 | colour.green * 255 << 8 | colour.blue * 255 << 0).toString()
					}
				}
			]
		})

		this.name = name
		this.languageId = languageId
	}

	protected router(t: ReturnType<typeof initTRPC.create<{ transformer: CombinedDataTransformer }>>) {
		return t.mergeRouters(
			super.router(t),
			t.router({})
		)
	}

	protected async validateDocumentSymbol(uri: string, documentSymbol: VDFDocumentSymbol): Promise<Diagnostic | null> {

		const key = documentSymbol.key.toLowerCase()
		if (key == "RunScriptCode".toLowerCase() || key == "RunScriptFile".toLowerCase()) {

			let diagnostic: Diagnostic | null = null

			if (documentSymbol.detail!.length + "\0".length >= 2 ** 12) {
				diagnostic = {
					range: documentSymbol.detailRange!,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-length",
					message: "Value exceeds maximum buffer size.",
				}
			}

			if (this.vscript == false) {
				this.trpc.client.popfile.vscript.install.query({ name: posix.basename(uri) })
				this.vscript = true
			}

			return diagnostic
		}

		return null
	}

	protected async getCompletionValues(uri: string, key: string): Promise<CompletionItem[] | null> {

		if (key == "classicon") {

			const teamFortress2DirectoryUri = `file:///${this.documentsConfiguration.get(uri).teamFortress2Folder}`

			const tfUri = `${teamFortress2DirectoryUri}/tf/materials/hud`
			const downloadUri = `${teamFortress2DirectoryUri}/tf/download/materials/hud`
			const customUris = (await this.trpc.client.fileSystem.readDirectory.query({ uri: `${teamFortress2DirectoryUri}/tf/custom` }))
				.filter(([, type]) => type == 2)
				.map(([name]) => `${teamFortress2DirectoryUri}/tf/custom/${name}`)
			const vpiUri = "vpk:///materials/hud?vpk=misc"

			const promises = [tfUri, downloadUri, ...customUris, vpiUri].map(async (path) => {
				return this.trpc.client.fileSystem.readDirectory.query({ uri: path })
					.then((items) => {
						return items
							.filter(([name]) => name.startsWith("leaderboard_class_") && name.endsWith(".vmt"))
							.map(([name]) => ({ label: posix.parse(name).name.slice(18), kind: CompletionItemKind.File }))
					})
					.catch(() => [])
			})
			const results = await Promise.all(promises)
			const allFiles = results.flatMap((files) => files)
			return [...new Set(allFiles)]
		}

		return null
	}
}
