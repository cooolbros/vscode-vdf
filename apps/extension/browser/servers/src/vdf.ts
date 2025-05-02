import { VGUILanguageServer } from "server/VDF/VGUI/VGUILanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

new VGUILanguageServer("vdf", "VDF", createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)), navigator.userAgent)
