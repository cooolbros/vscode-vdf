import { VMTLanguageServer } from "server/VDF/VMT/VMTLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new VMTLanguageServer("vmt", "VMT", connection)
