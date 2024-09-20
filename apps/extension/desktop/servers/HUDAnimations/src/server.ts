import { HUDAnimationsLanguageServer } from "server/HUDAnimations/HUDAnimationsLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new HUDAnimationsLanguageServer("hudanimations", "HUD Animations", connection)
