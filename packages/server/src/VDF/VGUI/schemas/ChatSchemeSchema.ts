import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument } from "../VGUITextDocument"
import { ClientSchemeSchema } from "./ClientSchemeSchema"

export const ChatSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocument> => {
	return ClientSchemeSchema(document)
}
