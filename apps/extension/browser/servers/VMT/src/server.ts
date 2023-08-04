import { VMTLanguageServer } from "lib/server/VDF/VMT/VMTLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

const connection = createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self))

const server = new VMTLanguageServer("VMT", "vmt", connection)
