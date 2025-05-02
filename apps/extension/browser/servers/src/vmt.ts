import { VMTLanguageServer } from "server/VDF/VMT/VMTLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

new VMTLanguageServer("vmt", "VMT", createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)), navigator.userAgent)
