import { HUDAnimationsLanguageServer } from "$lib/server/HUDAnimations/HUDAnimationsLanguageServer"
import { createConnection, ProposedFeatures } from "vscode-languageserver/node"

const connection = createConnection(ProposedFeatures.all)

const server = new HUDAnimationsLanguageServer("HUD Animations", "hudanimations", connection)
