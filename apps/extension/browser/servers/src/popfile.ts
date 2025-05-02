import { PopfileLanguageServer } from "server/VDF/Popfile/PopfileLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

new PopfileLanguageServer("popfile", "Popfile", createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)), navigator.userAgent)
