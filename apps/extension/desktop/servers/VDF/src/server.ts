import { VGUILanguageServer } from "server/VDF/VGUI/VGUILanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new VGUILanguageServer("VDF", "vdf", connection)
