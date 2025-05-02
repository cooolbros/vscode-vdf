import { HUDAnimationsLanguageServer } from "server/HUDAnimations/HUDAnimationsLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

new HUDAnimationsLanguageServer("hudanimations", "HUD Animations", createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)), navigator.userAgent)
