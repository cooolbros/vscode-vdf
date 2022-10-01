import { existsSync, readFileSync } from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { EndOfLine, Position, TextEditor, TextEditorEdit, Uri } from "vscode";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getVDFDocumentSymbols, VDFDocumentSymbol, VDFDocumentSymbols, VDFPosition } from "../../../shared/VDF/dist/getVDFDocumentSymbols";

const TFBotSquadRandomChoice = ["TFBot", "Squad", "RandomChoice"].map(i => i.toLowerCase())

export function importPopfileTemplates(editor: TextEditor, edit: TextEditorEdit): void {
	const documentSymbols = getVDFDocumentSymbols(editor.document.getText())

	type VDFDocumentSymbolChildren = VDFDocumentSymbol & { children: VDFDocumentSymbols }
	type VDFDocumentSymbolDetail = VDFDocumentSymbol & { detail: string }
	const VDFDocumentSymbolHasChildren = (documentSymbol: VDFDocumentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.children != undefined
	const VDFDocumentSymbolHasDetail = (documentSymbol: VDFDocumentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.detail != undefined

	const waveSchedule = documentSymbols
		.filter(VDFDocumentSymbolHasChildren)
		.flatMap((documentSymbol) => documentSymbol.children)

	const templatesInFile = waveSchedule
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.name.toLowerCase() == "templates" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap(documentSymbol => documentSymbol.children)
		.map((documentSymbol) => documentSymbol.name.toLowerCase())

	const referencedTemplates = waveSchedule
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.name.toLowerCase() == "wave" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.children)
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.name.toLowerCase() == "wavespawn" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.children)
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => TFBotSquadRandomChoice.includes(documentSymbol.name.toLowerCase()) && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.name.toLowerCase() == "tfbot" ? documentSymbol.children : documentSymbol.children.flatMap(documentSymbol => documentSymbol.children ?? []))
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolDetail => documentSymbol.name.toLowerCase() == "template" && VDFDocumentSymbolHasDetail(documentSymbol))
		.map((documentSymbol) => documentSymbol.detail.toLowerCase())

	const referencedTemplatesNotInFile = referencedTemplates.filter(template => !templatesInFile.includes(template))

	if (referencedTemplatesNotInFile.length == 0) {
		return
	}

	const baseFiles = documentSymbols
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolDetail => documentSymbol.name == "#base" && VDFDocumentSymbolHasDetail(documentSymbol))
		.map((documentSymbol) => documentSymbol.detail)

	const externalTemplates: [VDFDocumentSymbol, string][] = []

	for (const baseFile of baseFiles) {
		const baseFileUri = Uri.parse(path.join(dirname(editor.document.uri.toString(true)), baseFile))
		const baseFilePath = fileURLToPath(baseFileUri.toString(true))
		if (existsSync(baseFilePath)) {
			const baseFileContent = readFileSync(baseFilePath, "utf-8")
			const baseFileTextDocument = TextDocument.create(baseFileUri.toString(true), "popfile", 1, baseFileContent)
			const baseFileDocumentSymbols = getVDFDocumentSymbols(baseFileContent)
			const baseFileTemplatesDocumentSymbols = baseFileDocumentSymbols
				.filter(VDFDocumentSymbolHasChildren)
				.flatMap((documentSymbol) => documentSymbol.children)
				.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.name.toLowerCase() == "templates" && VDFDocumentSymbolHasChildren(documentSymbol))
				.flatMap(documentSymbol => documentSymbol.children)

			for (const baseFileTemplateDocumentSymbol of baseFileTemplatesDocumentSymbols) {
				const templateName = baseFileTemplateDocumentSymbol.name.toLowerCase()
				if (referencedTemplatesNotInFile.includes(templateName)) {
					const existingTemplateDocumentSymbol = externalTemplates.find(template => template[0].name == templateName)
					if (!existingTemplateDocumentSymbol) {
						externalTemplates.push([baseFileTemplateDocumentSymbol, baseFileTextDocument.getText(baseFileTemplateDocumentSymbol.range)])
					}
				}
			}
		}
	}

	let insertPosition = (() => {
		for (let i = waveSchedule.length - 1; i >= 0; i--) {
			const documentSymbol = waveSchedule[i]
			if (documentSymbol.name.toLowerCase() == "templates" && documentSymbol.children != undefined) {
				return documentSymbol.range.end
			}
		}
		return null
	})()

	const eol = editor.document.eol == EndOfLine.CRLF ? "\r\n" : "\n"
	let text
	if (insertPosition != null) {
		text = `${eol}${externalTemplates.map(template => `\t\t${template[1].split(/\r?\n/).join(eol)}`).join(eol.repeat(2))}${eol}\t`
	}
	else {
		text = `\tTemplates${eol}\t{${eol}${externalTemplates.map(template => `\t\t${template[1].split(/\r?\n/).join(eol)}`).join(eol.repeat(2))}${eol}\t}${eol.repeat(2)}`
		insertPosition = (() => {
			const WaveMission = ["Wave", "Mission"].map(i => i.toLowerCase())
			// Insert Templates before the first wave
			const position = waveSchedule.find(i => WaveMission.includes(i.name.toLowerCase()))!.range.start // There must be at least 1 wave for templates to be referenced, otherwise we would have exited early
			return new VDFPosition(position.line, position.character)
		})()
	}

	edit.insert(new Position(insertPosition.line, insertPosition.character - 1), text)
}
