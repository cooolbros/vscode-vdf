import { PopfileLanguageServer } from "server/VDF/Popfile/PopfileLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

const connection = createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self))

const server = new PopfileLanguageServer("popfile", "Popfile", connection)
