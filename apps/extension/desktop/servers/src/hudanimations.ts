import { HUDAnimationsLanguageServer } from "server/HUDAnimations/HUDAnimationsLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

new HUDAnimationsLanguageServer("hudanimations", "HUD Animations", createConnection(ProposedFeatures.all), `Node.js ${process.version}`)
