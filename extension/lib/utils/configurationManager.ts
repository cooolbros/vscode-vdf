import { DidChangeConfigurationNotification, _Connection } from "vscode-languageserver"
import { VSCodeVDFSettings } from "./tools"

export class Configuration<T = VSCodeVDFSettings> {

	private readonly connection: _Connection
	private readonly configuration: { [uri: string]: VSCodeVDFSettings }

	constructor(connection: _Connection) {
		this.connection = connection
		this.configuration = {}

		this.connection.onInitialized(() => {
			this.connection.client.register(DidChangeConfigurationNotification.type)
		})

		this.connection.onDidChangeConfiguration((params) => {
			for (const uri in this.configuration) {
				this.update(uri)
			}
		})
	}

	public async add(uri: string): Promise<void> {
		this.update(uri)
	}

	private update(uri: string) {
		this.connection.workspace.getConfiguration({ scopeUri: uri, section: "vscode-vdf" }).then((value) => {
			this.configuration[uri] = value
		})
	}

	public getConfiguration(uri: string): VSCodeVDFSettings | undefined {
		return this.configuration[uri]
	}

	public remove(uri: string) {
		delete this.configuration[uri]
	}
}
