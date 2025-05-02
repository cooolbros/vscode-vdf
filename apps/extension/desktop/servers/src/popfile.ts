import { PopfileLanguageServer } from "server/VDF/Popfile/PopfileLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

new PopfileLanguageServer("popfile", "Popfile", createConnection(ProposedFeatures.all), `Node.js ${process.version}`)
