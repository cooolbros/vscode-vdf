import { VDFLanguageServer } from "server/VDFLanguageServer"
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser"

new VDFLanguageServer(createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)), navigator.userAgent)
