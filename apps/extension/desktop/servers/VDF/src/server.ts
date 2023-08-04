import { VGUILanguageServer } from "lib/server/VDF/VGUI/VGUILanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new VGUILanguageServer("VDF", "vdf", connection)
