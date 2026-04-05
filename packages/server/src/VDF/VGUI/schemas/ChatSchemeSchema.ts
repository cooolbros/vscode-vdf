import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"
import { ClientSchemeSchema } from "./ClientSchemeSchema"

export const ChatSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {
	return ClientSchemeSchema(document)
}
