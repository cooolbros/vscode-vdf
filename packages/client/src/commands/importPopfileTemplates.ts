import { VSCodeVDFConfigurationSchema } from "common/VSCodeVDFConfiguration"
import { firstValueFrom } from "rxjs"
import { VDFPosition } from "vdf"
import { getVDFDocumentSymbols, VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { EndOfLine, Position, Range, workspace, WorkspaceEdit, type TextEditor } from "vscode"
import { TextDocument } from "vscode-languageserver-textdocument"
import { fileSystemMountPointFactory } from "../VirtualFileSystem/FileSystemMountPointFactory"

const TFBotSquadRandomChoice = ["TFBot", "Squad", "RandomChoice"].map(i => i.toLowerCase())

export async function importPopfileTemplates(editor: TextEditor): Promise<void> {
	const options = { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) }

	const documentSymbols = getVDFDocumentSymbols(editor.document.getText(), options)

	type VDFDocumentSymbolChildren = VDFDocumentSymbol & { children: VDFDocumentSymbols }
	type VDFDocumentSymbolDetail = VDFDocumentSymbol & { detail: string }
	const VDFDocumentSymbolHasChildren = (documentSymbol: VDFDocumentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.children != undefined
	const VDFDocumentSymbolHasDetail = (documentSymbol: VDFDocumentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.detail != undefined

	const waveSchedule = documentSymbols
		.filter(VDFDocumentSymbolHasChildren)
		.flatMap((documentSymbol) => documentSymbol.children)

	const templatesInFile = waveSchedule
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.key.toLowerCase() == "templates" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap(documentSymbol => documentSymbol.children)
		.map((documentSymbol) => documentSymbol.key.toLowerCase())

	const referencedTemplates = waveSchedule
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.key.toLowerCase() == "wave" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.children)
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.key.toLowerCase() == "wavespawn" && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.children)
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => TFBotSquadRandomChoice.includes(documentSymbol.key.toLowerCase()) && VDFDocumentSymbolHasChildren(documentSymbol))
		.flatMap((documentSymbol) => documentSymbol.key.toLowerCase() == "tfbot" ? documentSymbol.children : documentSymbol.children.flatMap(documentSymbol => documentSymbol.children ?? []))
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolDetail => documentSymbol.key.toLowerCase() == "template" && VDFDocumentSymbolHasDetail(documentSymbol))
		.map((documentSymbol) => documentSymbol.detail.toLowerCase())

	const referencedTemplatesNotInFile = referencedTemplates.filter(template => !templatesInFile.includes(template))

	if (referencedTemplatesNotInFile.length == 0) {
		return
	}

	const baseFiles = documentSymbols
		.filter((documentSymbol): documentSymbol is VDFDocumentSymbolDetail => documentSymbol.key == "#base" && VDFDocumentSymbolHasDetail(documentSymbol))

	const externalTemplates: [VDFDocumentSymbol, string][] = []

	const teamFortress2Folder = VSCodeVDFConfigurationSchema.parse(workspace.getConfiguration("vscode-vdf", editor.document.uri)).teamFortress2Folder
	const fileSystem = await fileSystemMountPointFactory.tf2(teamFortress2Folder)
	const decoder = new TextDecoder("utf-8")

	for (const baseFile of baseFiles) {

		const baseFileUri = await firstValueFrom(fileSystem.resolveFile(`scripts/population/${baseFile.detail}`))
		if (!baseFileUri) {
			continue
		}

		try {
			const baseFileContent = decoder.decode(await workspace.fs.readFile(baseFileUri))
			const baseFileTextDocument = TextDocument.create(baseFileUri.toString(), "popfile", 1, baseFileContent)
			const baseFileDocumentSymbols = getVDFDocumentSymbols(baseFileContent, options)
			const baseFileTemplatesDocumentSymbols = baseFileDocumentSymbols
				.filter(VDFDocumentSymbolHasChildren)
				.flatMap((documentSymbol) => documentSymbol.children)
				.filter((documentSymbol): documentSymbol is VDFDocumentSymbolChildren => documentSymbol.key.toLowerCase() == "templates" && VDFDocumentSymbolHasChildren(documentSymbol))
				.flatMap(documentSymbol => documentSymbol.children)

			for (const baseFileTemplateDocumentSymbol of baseFileTemplatesDocumentSymbols) {
				const templateName = baseFileTemplateDocumentSymbol.key.toLowerCase()
				if (referencedTemplatesNotInFile.includes(templateName)) {
					const existingTemplateDocumentSymbol = externalTemplates.find(template => template[0].key == templateName)
					if (!existingTemplateDocumentSymbol) {
						externalTemplates.push([baseFileTemplateDocumentSymbol, baseFileTextDocument.getText(baseFileTemplateDocumentSymbol.range)])
					}
				}
			}
		}
		catch (error: any) {
			console.error(error)
			continue
		}
	}

	let insertPosition = ((): VDFPosition | null => {
		for (let i = waveSchedule.length - 1; i >= 0; i--) {
			const documentSymbol = waveSchedule[i]
			if (documentSymbol.key.toLowerCase() == "templates" && documentSymbol.children != undefined) {
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
		insertPosition = ((): VDFPosition => {
			const WaveMission = ["Wave", "Mission"].map(i => i.toLowerCase())
			// Insert Templates before the first wave
			const position = waveSchedule.find(i => WaveMission.includes(i.key.toLowerCase()))!.range.start // There must be at least 1 wave for templates to be referenced, otherwise we would have exited early
			return new VDFPosition(position.line, position.character)
		})()
	}

	const edit = new WorkspaceEdit()
	for (const baseFile of baseFiles) {
		const range = new Range(
			new Position(baseFile.range.start.line, baseFile.range.start.character),
			new Position(baseFile.range.end.line, baseFile.range.end.character),
		)
		edit.delete(editor.document.uri, range)
	}
	edit.insert(editor.document.uri, new Position(insertPosition.line, insertPosition.character - 1), text)
	workspace.applyEdit(edit)
}
