import { VMTLanguageServer } from "server/VDF/VMT/VMTLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

new VMTLanguageServer("vmt", "VMT", createConnection(ProposedFeatures.all), `Node.js ${process.version}`)
