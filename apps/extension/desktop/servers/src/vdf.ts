import { VGUILanguageServer } from "server/VDF/VGUI/VGUILanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

new VGUILanguageServer("vdf", "VDF", createConnection(ProposedFeatures.all), `Node.js ${process.version}`)
