import { VDFLanguageServer } from "server/VDFLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const server = new VDFLanguageServer(createConnection(ProposedFeatures.all), `Node.js ${process.version}`)

// https://nodejs.org/api/process.html#event-uncaughtexception
process.on("uncaughtException", async (error) => {
	console.error(error)
	await server[Symbol.asyncDispose]()
	process.exit(1)
})
