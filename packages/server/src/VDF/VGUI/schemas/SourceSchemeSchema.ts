import type { VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"
import { ClientSchemeSchema } from "./ClientSchemeSchema"

export const SourceSchemeSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {
	return ClientSchemeSchema(document)
}
