import { HUDAnimationsLanguageServer } from "server/HUDAnimations/HUDAnimationsLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

const connection = createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self))

const server = new HUDAnimationsLanguageServer("hudanimations", "HUD Animations", connection)
