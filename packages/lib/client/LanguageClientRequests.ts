import type { Disposable } from "vscode"
import type { BaseLanguageClient } from "vscode-languageclient"
import { z } from "zod"
import type { languageClientsInfo } from "../languageClientsInfo"
import { VSCodeVDFLanguageIDSchema } from "../types/VSCodeVDFLanguageID"

const requestTypeSchema = z.string()

const sendRequestParamsSchema = z.tuple([VSCodeVDFLanguageIDSchema, requestTypeSchema, z.record(z.unknown())])

export function initLanguageClientRequests(languageClients: { [P in keyof typeof languageClientsInfo]?: BaseLanguageClient } = {}, languageClient: BaseLanguageClient): Disposable {

	return languageClient.onRequest("servers/sendRequest", async (params: unknown) => {

		const [languageID, requestType, param] = await sendRequestParamsSchema.parseAsync(params)

		const server = languageClients[languageID]
		if (!server) {
			throw new Error(`${languageID} language server not running.`)
		}

		return server.sendRequest(requestType, param)
	})
}
