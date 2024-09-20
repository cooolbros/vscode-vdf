import { PopfileLanguageServer } from "server/VDF/Popfile/PopfileLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new PopfileLanguageServer("popfile", "Popfile", connection)
