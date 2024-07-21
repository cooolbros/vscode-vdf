import { VGUILanguageServer } from "server/VDF/VGUI/VGUILanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

const connection = createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self))

const server = new VGUILanguageServer("VDF", "vdf", connection)
