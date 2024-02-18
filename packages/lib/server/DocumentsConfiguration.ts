import { VSCodeVDFConfigurationSchema, type VSCodeVDFConfiguration } from "lib/types/VSCodeVDFConfiguration"
import { DidChangeConfigurationNotification, type Connection } from "vscode-languageserver"

export class DocumentsConfiguration {

	private readonly connection: Connection

	private readonly configuration: Map<string, VSCodeVDFConfiguration>

	constructor(connection: Connection) {
		this.connection = connection
		this.configuration = new Map<string, VSCodeVDFConfiguration>()

		this.connection.onInitialized(this.onInitialized.bind(this))
		this.connection.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this))
	}

	private onInitialized(): void {
		this.connection.client.register(DidChangeConfigurationNotification.type)
	}

	private onDidChangeConfiguration(): void {
		for (const uri of this.configuration.keys()) {
			this.connection.workspace.getConfiguration({ scopeUri: uri, section: "vscode-vdf" }).then(async (settings) => {
				this.configuration.set(uri, await VSCodeVDFConfigurationSchema.parseAsync(settings))
			})
		}
	}

	public async add(uri: string): Promise<VSCodeVDFConfiguration> {
		const settings = await VSCodeVDFConfigurationSchema.parseAsync(await this.connection.workspace.getConfiguration({ scopeUri: uri, section: "vscode-vdf" }))
		this.configuration.set(uri, settings)
		return settings
	}

	public get(uri: string): VSCodeVDFConfiguration {
		return this.configuration.get(uri)!
	}

	public delete(uri: string): boolean {
		return this.configuration.delete(uri)
	}
}
