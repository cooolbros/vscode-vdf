import { of, type Observable } from "rxjs"
import type { VSCodeVDFConfiguration } from "utils/types/VSCodeVDFConfiguration"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { CodeActionKind, DiagnosticSeverity } from "vscode-languageserver"
import type { Definitions } from "../../DefinitionReferences"
import type { DiagnosticCodeAction } from "../../LanguageServer"
import type { TeamFortress2FileSystem } from "../../TeamFortress2FileSystem"
import type { TextDocumentInit } from "../../TextDocumentBase"
import type { TextDocuments } from "../../TextDocuments"
import { VDFTextDocument, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import values from "./values.json"

export interface PopfileTextDocumentDependencies {
}

export class PopfileTextDocument extends VDFTextDocument<PopfileTextDocument, PopfileTextDocumentDependencies> {

	public static readonly Schema: VDFTextDocumentSchema = {
		keys: keys,
		values: values,
		definitionReferences: [
			{
				type: Symbol.for("template"),
				definition: {
					directParentKeys: ["Templates".toLowerCase()],
					children: true,
					key: null
				},
				reference: {
					keys: new Set(["Template".toLowerCase()]),
					match: null
				}
			},
			{
				type: Symbol.for("wavespawn"),
				definition: {
					directParentKeys: ["Wave".toLowerCase()],
					children: true,
					key: { name: "name", priority: true }
				},
				reference: {
					keys: new Set([
						"WaitForAllSpawned".toLowerCase(),
						"WaitForAllDead".toLowerCase()
					]),
					match: null
				}
			}
		],
		files: [
			{
				name: "class icon",
				parentKeys: [],
				keys: new Set([
					"ClassIcon".toLowerCase()
				]),
				folder: "materials/hud",
				resolve: (value: string) => `leaderboard_class_${value.toLowerCase()}.vmt`,
				extensionsPattern: ".vmt",
				displayExtensions: false
			}
		],
		colours: {
			keys: {
				include: new Set(["set item tint rgb"]),
				exclude: null
			},
			colours: [
				{
					pattern: /\d+/,
					parse(value) {
						const colour = parseInt(value)
						return {
							red: ((colour >> 16) & 255) / 255,
							green: ((colour >> 8) & 255) / 255,
							blue: ((colour >> 0) & 255) / 255,
							alpha: 255
						}
					},
					stringify(colour) {
						return (colour.red * 255 << 16 | colour.green * 255 << 8 | colour.blue * 255 << 0).toString()
					}
				}
			]
		}
	}

	constructor(
		init: TextDocumentInit,
		documentConfiguration: Observable<VSCodeVDFConfiguration>,
		fileSystem$: Observable<TeamFortress2FileSystem>,
		documents: TextDocuments<PopfileTextDocument>
	) {
		super(init, documentConfiguration, fileSystem$, documents, {
			relativeFolderPath: "scripts/population",
			VDFTokeniserOptions: { allowMultilineStrings: true },
			keyTransform: (key) => key,
			dependencies$: of({ schema: PopfileTextDocument.Schema, global: [] }),
			getCodeLens: (definitionReferences$) => {
				return definitionReferences$
			}
		})
	}

	protected validateDocumentSymbol(documentSymbol: VDFDocumentSymbol, path: VDFDocumentSymbol[], documentSymbols: VDFDocumentSymbols, definitions: Definitions): null | DiagnosticCodeAction | Observable<DiagnosticCodeAction | null> {
		const key = documentSymbol.key.toLowerCase()

		// https://github.com/cooolbros/vscode-vdf/issues/33
		if ((key == "Squad".toLowerCase()) && documentSymbol.children && documentSymbol.children.length == 1 && this.configuration.keyTransform(documentSymbol.children[0].key.toLowerCase()) == "TFBot".toLowerCase()) {
			return {
				range: documentSymbol.range,
				severity: DiagnosticSeverity.Warning,
				code: "useless-squad",
				source: "popfile",
				message: "Squad with 1 TFBot is useless.",
				data: {
					kind: CodeActionKind.QuickFix,
					fix: (createDocumentWorkspaceEdit) => {
						return {
							title: `Replace Squad with TFBot`,
							edit: createDocumentWorkspaceEdit(documentSymbol.range, this.document.getText(documentSymbol.children![0]!.range))
						}
					},
				}
			}
		}

		if (key == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {

			// https://github.com/cooolbros/vscode-vdf/issues/34
			const maxActive = parseInt(documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "MaxActive".toLowerCase())?.detail ?? "")
			const spawnCount = parseInt(documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "SpawnCount".toLowerCase())?.detail ?? "")
			if (!isNaN(maxActive) && !isNaN(spawnCount) && spawnCount > maxActive) {
				return {
					range: documentSymbol.nameRange,
					severity: DiagnosticSeverity.Warning,
					code: "wavespawn-softlock",
					source: "popfile",
					message: `WaveSpawn with MaxActive ${maxActive} and SpawnCount ${spawnCount} will cause softlock`,
				}
			}
			else {
				return null
			}
		}

		// https://github.com/cooolbros/vscode-vdf/issues/35
		const waveSpawnType = Symbol.for("wavespawn")
		if (PopfileTextDocument.Schema.definitionReferences.find(({ type }) => type == waveSpawnType)!.reference!.keys.has(key) && documentSymbol?.detail != undefined) {
			for (const waveSpawnDefinition of definitions.get(Symbol.for("wavespawn"), documentSymbol.detail) ?? []) {
				const waveSpawnDocumentSymbol = documentSymbols.getDocumentSymbolAtPosition(waveSpawnDefinition.range.start)!
				const support = waveSpawnDocumentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Support".toLowerCase())?.detail
				if (support != undefined && support.toLowerCase() != "Limited".toLowerCase()) {
					return {
						range: documentSymbol.detailRange!,
						severity: DiagnosticSeverity.Warning,
						code: "wavespawn-softlock",
						source: "popfile",
						message: `${documentSymbol.key} '${documentSymbol.detail}' will cause softlock because ${waveSpawnDefinition.key} has Support '${support}'`,
					}
				}
			}

			return null
		}


		// https://github.com/cooolbros/vscode-vdf/issues/29
		if ((key == "RunScriptCode".toLowerCase() || key == "RunScriptFile".toLowerCase()) && documentSymbol.detail && ((documentSymbol.detail.length + "\0".length) >= 2 ** 12)) {
			return {
				range: documentSymbol.detailRange!,
				severity: DiagnosticSeverity.Warning,
				code: "invalid-length",
				source: "popfile",
				message: "Value exceeds maximum buffer size.",
			}
		}

		return null
	}
}
