import * as path from "path";
import { ExtensionContext } from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from "vscode-languageclient/node";

let client: LanguageClient

export function activate(context: ExtensionContext): void {

	// Commands




	// Language Server
	const serverModule = context.asAbsolutePath(path.join("server", "dist", "server.js"))

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: [
					"--nolazy",
					"--inspect=6009"
				]
			}
		}
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			"vdf"
		],
		// synchronize: {
		// 	fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		// }
	}

	client = new LanguageClient(
		"vdf-language-server",
		"VDF Language Server",
		serverOptions,
		clientOptions
	)

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
