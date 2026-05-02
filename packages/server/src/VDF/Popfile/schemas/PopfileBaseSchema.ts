import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import { combineLatest, firstValueFrom, map } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol, VDFDocumentSymbols } from "vdf-documentsymbols"
import { quote } from "vdf-format"
import { CompletionItem, CompletionItemKind, DiagnosticSeverity, InlayHint, InlayHintKind, InsertTextFormat, MarkupKind, TextEdit } from "vscode-languageserver"
import { Collection, type Definition, type DefinitionReferences } from "../../../DefinitionReferences"
import { TextDocumentBase, type DiagnosticCodeAction, type DiagnosticCodeActions, type DocumentLinkData } from "../../../TextDocumentBase"
import { KeyDistinct, VGUIAssetType, type Context, type Fallback, type RefineReference, type RefineString, type Validate, type VDFTextDocumentSchema } from "../../VDFTextDocument"
import { PopfileTextDocument, type PopfileTextDocumentDependencies } from "../PopfileTextDocument"
import keys from "../keys.json"
import values from "../values.json"

/**
 * {@link PopfileBaseSchema}
 * {@link createNewGetDiagnostics}
 */

const set_item_tint_rgb = "set item tint RGB".toLowerCase()
const set_item_tint_rgb_2 = "set item tint RGB 2".toLowerCase()

const attach_particle_effect = "attach particle effect"
const attach_particle_effect_static = "attach particle effect static"

const sounds = new Set([
	"DoneWarningSound".toLowerCase(),
	"FirstSpawnWarningSound".toLowerCase(),
	"LastSpawnWarningSound".toLowerCase(),
	"Sound".toLowerCase(),
	"StartWaveWarningSound".toLowerCase(),
])

const soundChars = new Set([
	"*" /* CHAR_STREAM */,
	"?" /* CHAR_USERVOX */,
	"!" /* CHAR_SENTENCE */,
	"#" /* CHAR_DRYMIX */,
	">" /* CHAR_DOPPLER */,
	"<" /* CHAR_DIRECTIONAL */,
	"^" /* CHAR_DISTVARIANT */,
	"@" /* CHAR_OMNI */,
	")" /* CHAR_SPATIALSTEREO */,
	"}" /* CHAR_FAST_PITCH */,
])

const removeSoundChars = (value: string): { chars: string, value: string } => {
	let i = 0
	while (i < value.length) {
		if (!soundChars.has(value[i])) {
			break
		}
		i += 1
	}

	const chars = value.slice(0, i)
	value = value.slice(i)
	return { chars, value }
}

function collectTFBotItems(path: VDFDocumentSymbol[], definitionReferences: DefinitionReferences) {
	const collectTemplateAttributes = (detail: string, definitionReferences: DefinitionReferences, seen: Set<string>): { TFClass?: string, items: string[] } => {
		const definitions = definitionReferences.definitions.get(null, Symbol.for("template"), detail)
		if (!definitions || !definitions.length) {
			return { TFClass: undefined, items: [] }
		}

		let { template, TFClass, items } = definitions[0].data as { template?: string, TFClass?: string, items: string[] }
		if (template != undefined && !seen.has(template.toLowerCase())) {
			seen.add(template.toLowerCase())
			const result = collectTemplateAttributes(template, definitionReferences, seen)
			TFClass ??= result.TFClass
			items.push(...result.items)
		}

		return {
			TFClass,
			items
		}
	}

	const parent = path.at(-3)
	if (!parent) {
		return null
	}

	let TFBot: VDFDocumentSymbols | undefined
	let defaultAttributes: VDFDocumentSymbols | undefined
	let currentAttributes: VDFDocumentSymbols | undefined

	if (parent.key.toLowerCase() == "EventChangeAttributes".toLowerCase()) {
		TFBot = path.at(-4 /* * => EventChangeAttributes => * => ItemAttributes */)?.children
		defaultAttributes = parent.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Default".toLowerCase())?.children
		currentAttributes = path.at(-2)!.children
	}
	else {
		TFBot = path.at(-2 /* TFBot => ItemAttributes */)?.children
		defaultAttributes = undefined
		currentAttributes = undefined
	}

	if (!TFBot) {
		return null
	}

	const items: string[] = []
	const botItems: string[] = []
	const templateItems: string[] = []

	let TFBotClass = TFBot.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Class".toLowerCase())?.detail
	const template = TFBot.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())

	for (const documentSymbol of TFBot) {
		if (documentSymbol == template) {
			if (template.detail == undefined) {
				continue
			}

			const { TFClass, items } = collectTemplateAttributes(template.detail, definitionReferences, new Set([template.detail.toLowerCase()]))
			TFBotClass ??= TFClass
			templateItems.push(...items)
		}
		else if (documentSymbol.key.toLowerCase() == "Item".toLowerCase() && documentSymbol.detail != undefined) {
			botItems.push(documentSymbol.detail)
		}
	}

	// Use case sensitive class name for diagnostic message instead of case insensitive user defined key
	let canonicalClassName = undefined

	if (TFBotClass != undefined) {
		switch (TFBotClass.toLowerCase()) {
			// Offense
			case "Scout".toLowerCase():
				canonicalClassName = "Scout"
				items.push("TF_WEAPON_SCATTERGUN", "TF_WEAPON_PISTOL_SCOUT", "TF_WEAPON_BAT")
				break
			case "Soldier".toLowerCase():
				canonicalClassName = "Soldier"
				items.push("TF_WEAPON_ROCKETLAUNCHER", "TF_WEAPON_SHOTGUN_SOLDIER", "TF_WEAPON_SHOVEL")
				break
			case "Pyro".toLowerCase():
				canonicalClassName = "Pyro"
				items.push("TF_WEAPON_FLAMETHROWER", "TF_WEAPON_SHOTGUN_PYRO", "TF_WEAPON_FIREAXE")
				break
			// Defense
			case "Demoman".toLowerCase():
				canonicalClassName = "Demoman"
				items.push("TF_WEAPON_GRENADELAUNCHER", "TF_WEAPON_PIPEBOMBLAUNCHER", "TF_WEAPON_BOTTLE")
				break
			case "Heavy".toLowerCase():
			case "Heavyweapons".toLowerCase():
				canonicalClassName = "Heavyweapons"
				items.push("TF_WEAPON_MINIGUN", "TF_WEAPON_SHOTGUN_HWG", "TF_WEAPON_FISTS")
				break
			case "Engineer".toLowerCase():
				canonicalClassName = "Engineer"
				items.push("TF_WEAPON_SHOTGUN_PRIMARY", "TF_WEAPON_PISTOL", "TF_WEAPON_WRENCH", "TF_WEAPON_PDA_ENGINEER_BUILD", "TF_WEAPON_PDA_ENGINEER_DESTROY")
				break
			// Support
			case "Medic".toLowerCase():
				canonicalClassName = "Medic"
				items.push("TF_WEAPON_SYRINGEGUN_MEDIC", "TF_WEAPON_MEDIGUN", "TF_WEAPON_BONESAW")
				break
			case "Sniper".toLowerCase():
				canonicalClassName = "Sniper"
				items.push("TF_WEAPON_SNIPERRIFLE", "TF_WEAPON_SMG", "TF_WEAPON_CLUB")
				break
			case "Spy".toLowerCase():
				canonicalClassName = "Spy"
				items.push("TF_WEAPON_REVOLVER", "TF_WEAPON_BUILDER_SPY", "TF_WEAPON_KNIFE", "TF_WEAPON_PDA_SPY", "TF_WEAPON_INVIS")
				break
		}
	}

	if (defaultAttributes != undefined) {
		const defaultItems = defaultAttributes
			.values()
			.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Item".toLowerCase() && documentSymbol.detail != undefined)
			.map((documentSymbol) => documentSymbol.detail!)
			.toArray()
		botItems.push(...defaultItems)
	}

	if (currentAttributes != undefined && currentAttributes != defaultAttributes) {
		const currentItems = currentAttributes
			.values()
			.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Item".toLowerCase() && documentSymbol.detail != undefined)
			.map((documentSymbol) => documentSymbol.detail!)
			.toArray()
		botItems.push(...currentItems)
	}

	items.push(...botItems)
	items.push(...templateItems)

	return {
		canonicalClassName,
		items,
	}
}

export interface DefinitionsSchema {
	getTemplates: (documentSymbols: VDFDocumentSymbols) => IteratorObject<VDFDocumentSymbol>
}

interface CreateDiagnosticParams {
	document: PopfileTextDocument
	createUnknownAttributeCodeAction: (documentSymbol: VDFDocumentSymbol, context: Context<PopfileTextDocumentDependencies>) => DiagnosticCodeAction["data"]
}

export interface DiagnosticsSchema {
	TemplatesDistinct: KeyDistinct
	createValidateEvent: (params: CreateDiagnosticParams) => Fallback<PopfileTextDocumentDependencies>
	createValidateTemplateReference: (params: CreateDiagnosticParams) => RefineReference<PopfileTextDocumentDependencies>
}

/**
 * @class {PopfileBaseSchema}
 */
export const PopfileBaseSchema = ({ definitionsSchema, diagnosticsSchema }: { definitionsSchema: DefinitionsSchema, diagnosticsSchema: DiagnosticsSchema }) => {
	const newGetDiagnostics = createNewGetDiagnostics(diagnosticsSchema)
	return (document: PopfileTextDocument): VDFTextDocumentSchema<PopfileTextDocumentDependencies> => {
		const getDiagnostics = newGetDiagnostics(document)
		return {
			keys,
			values,
			getDefinitionReferences: ({ dependencies, documentSymbols }) => {
				const wavespawn = Symbol.for("wavespawn")
				const template = Symbol.for("template")
				const item = Symbol.for("item")

				const scopes = new Map<symbol, Map<number, VDFRange>>([
					[
						wavespawn,
						new Map(
							documentSymbols
								.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined)
								.map((documentSymbol, index) => [index, documentSymbol.range])
						)
					]
				])

				const definitions = new Collection<Definition>()
				const references = new Collection<VDFRange>()

				for (const documentSymbol of definitionsSchema.getTemplates(documentSymbols)) {
					if (!documentSymbol.children || documentSymbol.children.length == 0) {
						continue
					}

					const templateTemplate = documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Template".toLowerCase())

					documentSymbol.children.forEach((documentSymbol) => {
						if (!documentSymbol.detail) {
							return
						}

						switch (documentSymbol.key.toLowerCase()) {
							case "Template".toLowerCase():
								references.set(null, template, documentSymbol.detail!, documentSymbol.detailRange!)
								break
							case "Item".toLowerCase():
								references.set(null, item, documentSymbol.detail!, documentSymbol.detailRange!)
								break
						}
					})

					definitions.set(null, template, documentSymbol.key, {
						uri: document.uri,
						key: documentSymbol.key,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: undefined,
						detail: undefined,
						documentation: document.definitions.documentation(documentSymbol),
						conditional: documentSymbol.conditional ?? undefined,
						data: {
							template: templateTemplate?.detail,
							TFClass: documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Class".toLowerCase())?.detail,
							items: documentSymbol.children
								.values()
								.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Item".toLowerCase() && documentSymbol.detail != undefined)
								.map((documentSymbol) => documentSymbol.detail!)
								.toArray(),
							events: (documentSymbol.children
								.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "EventChangeAttributes".toLowerCase())
								?.children ?? [])
								.filter((documentSymbol) => documentSymbol.children != undefined)
								.map((documentSymbol) => ({ key: documentSymbol.key, range: documentSymbol.nameRange }))
						}
					})
				}

				for (const [index, documentSymbol] of documentSymbols.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined).entries()) {

					documentSymbol.children!.forEach((documentSymbol) => {

						const key = documentSymbol.key.toLowerCase()

						if (key == "Sound".toLowerCase() && documentSymbol.detail != undefined) {
							const { value } = removeSoundChars(documentSymbol.detail)
							if (dependencies.game_sounds.get(null, Symbol.for("sound"), value)?.length) {
								references.set(null, Symbol.for("sound"), value, documentSymbol.detailRange!)
							}
						}

						if (key == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
							const name = documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "Name".toLowerCase())
							if (name?.detail != undefined) {
								definitions.set(index, wavespawn, name.detail!, {
									uri: document.uri,
									key: name.detail,
									range: documentSymbol.range,
									keyRange: name.detailRange!,
									nameRange: undefined,
									detail: name.detail!,
									documentation: document.definitions.documentation(documentSymbol),
									conditional: documentSymbol.conditional ?? undefined,
								})
							}

							const values = Map.groupBy(
								documentSymbol.children,
								(documentSymbol) => {
									const key = documentSymbol.key.toLowerCase()
									if (key == "WaitForAllSpawned".toLowerCase() || key == "WaitForAllDead".toLowerCase()) {
										return "wavespawn"
									}
									else if (sounds.difference(new Set(["Sound".toLowerCase()])).has(key)) {
										return "sound"
									}
									else if (!waveSpawnKeys.includes(documentSymbol.key.toLowerCase())) {
										return "spawner"
									}
									else {
										return null
									}
								}
							)

							for (const documentSymbol of values.get("wavespawn") ?? []) {
								if (documentSymbol.detail != undefined) {
									references.set(index, wavespawn, documentSymbol.detail!, documentSymbol.detailRange!)
								}
							}

							for (const spawner of values.get("spawner") ?? []) {
								spawner.children?.forAll((documentSymbol) => {
									if (documentSymbol.key.toLowerCase() == "Template".toLowerCase() && documentSymbol.detail != undefined) {
										references.set(null, template, documentSymbol.detail!, documentSymbol.detailRange!)
									}
									else if ((documentSymbol.key.toLowerCase() == "Item".toLowerCase() || documentSymbol.key.toLowerCase() == "ItemName".toLowerCase()) && documentSymbol.detail != undefined) {
										references.set(null, item, documentSymbol.detail!, documentSymbol.detailRange!)
									}
								})
							}

							for (const sound of values.get("sound") ?? []) {
								if (sound.detail) {
									const { value } = removeSoundChars(sound.detail)
									if (dependencies.game_sounds.get(null, Symbol.for("sound"), value)?.length) {
										references.set(null, Symbol.for("sound"), value, sound.detailRange!)
									}
								}
							}
						}
					})
				}

				return {
					scopes: scopes,
					definitions: definitions,
					references: references,
				}
			},
			definitionReferences: new Map([
				[Symbol.for("template"), { keys: new Set(["Template".toLowerCase()]) }],
				[Symbol.for("wavespawn"), { keys: new Set(["WaitForAllSpawned".toLowerCase(), "WaitForAllDead".toLowerCase()]) }],
				[Symbol.for("item"), { keys: new Set(["Item".toLowerCase()]) }],
			]),
			getDiagnostics: (params) => {
				params.dependencies.classIcons.clear()
				const diagnostics = getDiagnostics(params)

				for (const [classIcon, ranges] of params.dependencies.classIcons) {
					diagnostics.push(
						document.workspace.classIconFlags(classIcon).pipe(
							map((vtf) => {
								if (vtf == null) {
									return {
										severity: DiagnosticSeverity.Warning,
										code: "missing-file",
										source: "popfile",
										message: `Cannot find class icon '${classIcon}'.`,
									}
								}

								// https://github.com/cooolbros/vscode-vdf/issues/62
								const noMip = (vtf.flags & 256) == 256
								const noLod = (vtf.flags & 512) == 512

								if (!noMip || !noLod) {
									return {
										severity: DiagnosticSeverity.Warning,
										code: "missing-vtf-flags",
										source: "popfile",
										message: `ClassIcon '${classIcon}' does not set VTF flag${!noMip && !noLod ? "s" : ""} ${!noMip ? `"No Mipmap"` : ""}${!noMip && !noLod ? " and " : ""}${!noLod ? `"No Level Of Detail"` : ""}.`,
										data: {
											fix: () => {
												return {
													title: `Set VTF flags: "No Mipmap" and "No Level Of Detail".`,
													command: {
														title: "",
														command: "vscode-vdf.setVTFFlags",
														arguments: [vtf.uri, 256 | 512]
													}
												}
											},
										}
									}
								}

								return null
							}),
							map((diagnostic) => {
								if (!diagnostic) {
									return null
								}

								return ranges.map((range) => ({
									range: range,
									...diagnostic
								}))
							})
						)
					)
				}

				return diagnostics
			},
			getLinks: ({ documentSymbols, definitionReferences, resolve }) => {
				const links: DocumentLinkData[] = []

				documentSymbols.forEach((documentSymbol) => {
					documentSymbol.children?.forAll((documentSymbol) => {
						const key = documentSymbol.key.toLowerCase()

						if (key == "ClassIcon".toLowerCase() && documentSymbol.detail?.trim() != "") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(`materials/hud/leaderboard_class_${documentSymbol.detail}.vmt`))
								}
							})
							return
						}

						if (sounds.has(key) && documentSymbol.detail != undefined) {
							const value = documentSymbol.detail.trim()
							if (value.length) {
								const { value: sound } = removeSoundChars(documentSymbol.detail.trim())
								const definitions = definitionReferences.definitions.get(null, Symbol.for("sound"), sound)
								if (!definitions || !definitions.length) {
									links.push({
										range: documentSymbol.detailRange!,
										data: {
											resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`sound/${removeSoundChars(documentSymbol.detail!).value}`)))
										}
									})
								}
							}
							return
						}
					})
				})

				return links
			},
			getColours: ({ next }) => {
				return next((colours, documentSymbol) => {
					const key = documentSymbol.key.toLowerCase()
					if ((key == set_item_tint_rgb || key == set_item_tint_rgb_2) && documentSymbol.detail != undefined && /^\d+$/.test(documentSymbol.detail)) {
						const colour = parseInt(documentSymbol.detail)

						const red = ((colour >> 16) & 255) / 255
						const green = ((colour >> 8) & 255) / 255
						const blue = ((colour >> 0) & 255) / 255
						const alpha = 255

						colours.push({
							range: documentSymbol.detailRange!,
							color: { red, green, blue, alpha },
							stringify: (colour) => (colour.red * 255 << 16 | colour.green * 255 << 8 | colour.blue * 255 << 0).toString(),
						})
					}
				})
			},
			getInlayHints: async ({ documentSymbols }) => {
				const [paints, effects] = await Promise.all([
					document.workspace.paints,
					document.workspace.effects
				])

				return documentSymbols.reduce(
					(inlayHints, documentSymbol) => {
						if (!documentSymbol.children) {
							return inlayHints
						}

						inlayHints.push(
							...documentSymbol.children.reduceRecursive(
								<InlayHint[]>[],
								(inlayHints, documentSymbol) => {
									const key = documentSymbol.key.toLowerCase()
									if ((key == set_item_tint_rgb || key == set_item_tint_rgb_2) && documentSymbol.detail != undefined) {
										if (paints.has(documentSymbol.detail!)) {
											inlayHints.push({
												position: documentSymbol.detailRange!.end,
												label: paints.get(documentSymbol.detail!)!,
												kind: InlayHintKind.Type,
												paddingLeft: true
											})
										}
									}

									if ((key == attach_particle_effect || key == attach_particle_effect_static) && documentSymbol.detail != undefined) {
										if (effects.has(documentSymbol.detail!)) {
											inlayHints.push({
												position: documentSymbol.detailRange!.end,
												label: effects.get(documentSymbol.detail!)!,
												kind: InlayHintKind.Type,
												paddingLeft: true
											})
										}
									}

									return inlayHints
								}
							)
						)

						return inlayHints
					},
					<InlayHint[]>[]
				)
			},
			completion: {
				root: [
					{
						label: "WaveSchedule",
						kind: CompletionItemKind.Class,
						preselect: true,
						insertText: "WaveSchedule\n{\n\t$0\n}",
						insertTextFormat: InsertTextFormat.Snippet
					}
				],
				typeKey: null,
				defaultType: null,
				files: [
					{
						keys: new Set([
							"ClassIcon".toLowerCase()
						]),
						folder: "materials/hud",
						extensionsPattern: ".vmt",
						toCompletionItem: (name, type, withoutExtension) => {
							if (type == 1 && name.startsWith("leaderboard_class_")) {
								const insertText = withoutExtension().substring("leaderboard_class_".length)
								return {
									label: name.substring("leaderboard_class_".length),
									insertText: insertText,
								}
							}
							else {
								return null
							}
						},
						asset: VGUIAssetType.Image
					}
				],
				values: {
					...Object.fromEntries(sounds.values().map((value) => [value, async ({ text, files }) => {
						const [soundFiles, soundScripts] = await Promise.all([
							files("sound", { value: text ?? null, extensionsPattern: null }),
							firstValueFrom(document.definitionReferences$).then((definitionReferences) =>
								definitionReferences.definitions.ofType(null, Symbol.for("sound"))
									.values()
									.filter((value) => value.length)
									.filter((value) => text ? value[0].key.toLowerCase().startsWith(text.toLowerCase()) : true)
									.map((value) => {
										const { kind = CompletionItemKind.Variable, ...rest } = value[0].completionItem ?? {}
										return {
											label: value[0].key,
											kind: kind,
											documentation: value[0].documentation && {
												kind: MarkupKind.Markdown,
												value: value[0].documentation
											},
											...rest,
										} satisfies CompletionItem
									})
							),
						])

						return [...soundFiles, ...soundScripts]
					}])),
					[`${"ItemName".toLowerCase()}`]: async ({ text, position }) => {
						const { documentSymbols, definitionReferences } = await firstValueFrom(combineLatest({
							documentSymbols: document.documentSymbols$,
							definitionReferences: document.definitionReferences$
						}))

						const path = documentSymbols.getPathAtPosition(position)!
						const result = collectTFBotItems(path, definitionReferences)
						if (result == null) {
							return []
						}

						return result
							.items
							.values()
							.filter(text != undefined ? (value) => value.startsWith(text.toLowerCase()) : () => true)
							.map((item) => ({
								label: item,
								kind: CompletionItemKind.Field,
							}))
							.toArray()
					}
				}
			}
		}

	}

}

function createNewGetDiagnostics(diagnosticsSchema: DiagnosticsSchema) {
	const { TemplatesDistinct, createValidateEvent, createValidateTemplateReference } = diagnosticsSchema
	return (document: PopfileTextDocument) => {
		const { unreachable, any, header, string, length, integer, float, set, dynamic, reference } = document.diagnostics

		const createUnknownAttributeCodeAction = (documentSymbol: VDFDocumentSymbol, context: Context<PopfileTextDocumentDependencies>): DiagnosticCodeAction["data"] => ({
			fix: ({ createDocumentWorkspaceEdit }) => {
				const conditional = context.documentSymbols?.findRecursive((documentSymbol) => {
					return documentSymbol.conditional != null && !TextDocumentBase.conditionals.values().some((conditional) => {
						return conditional.toLowerCase() == documentSymbol.conditional?.toLowerCase()
					})
				})?.documentSymbol.conditional

				if (!conditional) {
					return null
				}

				return {
					title: `Add ${conditional}`,
					edit: createDocumentWorkspaceEdit(TextEdit.insert((documentSymbol.detail != undefined ? documentSymbol.range : documentSymbol.nameRange).end, ` ${conditional}`))
				}
			}
		})

		const validateEvent = createValidateEvent({ document, createUnknownAttributeCodeAction })
		const validateTemplateReference = createValidateTemplateReference({ document, createUnknownAttributeCodeAction })

		const documentSymbols = document.diagnostics.documentSymbols(KeyDistinct.Last, (key, parent, documentSymbol, context) => {
			if (!context.documentConfiguration.popfile.diagnostics.strict) {
				return []
			}

			return [{
				range: documentSymbol.nameRange,
				severity: DiagnosticSeverity.Warning,
				code: "unknown-key",
				source: "popfile",
				message: `Unknown attribute '${key}' in ${parent} definition.`,
				data: createUnknownAttributeCodeAction(documentSymbol, context)
			}]
		})

		const validateMob = documentSymbols({
			"Count": [string(integer)],
		}, (documentSymbol, path, context, unknown) => validateSpawner("Mob", documentSymbol, path, context))

		const validateRandomChoice = documentSymbols({}, (documentSymbol, path, context) => validateSpawner("RandomChoice", documentSymbol, path, context))

		const validateSentryGun = documentSymbols({ "Level": [string(set(["1", "2", "3"]))] })

		const validateSquadDocumentSymbols = documentSymbols({
			"FormationSize": [string(float)],
			"ShouldPreserveSquad": [string(set(["0", "1"]))]
		}, (documentSymbol, path, context) => validateSpawner("Squad", documentSymbol, path, context))

		const validateSquad: Validate<PopfileTextDocumentDependencies> = (key, documentSymbol, path, context) => {
			const diagnostics: DiagnosticCodeActions = []
			diagnostics.push(...validateSquadDocumentSymbols(key, documentSymbol, path, context))

			// https://github.com/cooolbros/vscode-vdf/issues/33
			if (documentSymbol.children?.length == 1 && documentSymbol.children[0].key.toLowerCase() == "TFBot".toLowerCase()) {
				diagnostics.push({
					range: documentSymbol.range,
					severity: DiagnosticSeverity.Warning,
					code: "useless-squad",
					source: "popfile",
					message: "Squad with 1 TFBot is useless.",
					data: {
						fix: ({ createDocumentWorkspaceEdit }) => {
							return {
								title: "Replace Squad with TFBot",
								edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.range, document.getText(documentSymbol.children![0]!.range)))
							}
						},
					}
				})
			}

			return diagnostics
		}

		const validateOutput = documentSymbols({
			"Action": [string()],
			"Delay": [string(float)],
			// https://github.com/cooolbros/vscode-vdf/issues/29
			"Param": [string(length(4096))],
			"Target": [string()],
		})

		const validateTank = documentSymbols({
			"Health": [string(integer)],
			"Name": [string()],
			"OnBombDroppedOutput": [validateOutput],
			"OnKilledOutput": [validateOutput],
			"Skin": [string(set(["0", "1"]))],
			"Speed": [string(float)],
			"StartingPathTrackNode": [string()],
		})

		const validateItemKey: RefineReference<PopfileTextDocumentDependencies> = (name, detail, detailRange, documentSymbol, path, context, definitions) => {
			return [TextDocumentBase.diagnostics.key(definitions[0].key, detail, detailRange)]
		}

		const validateItem = string(reference(Symbol.for("item"), validateItemKey))

		const validateItemNameOwner: RefineString<PopfileTextDocumentDependencies> = (name, detail, detailRange, documentSymbol, path, context) => {

			const result = collectTFBotItems(path, context.definitionReferences)!
			const canonicalClassName = result.canonicalClassName
			const items = result.items ?? []

			if (items.length == 0 || !items.some((item) => item.toLowerCase() == detail.toLowerCase())) {
				const position = path.at(-1)!.nameRange.start
				const before = document.getText({
					start: { line: position.line, character: 0 },
					end: { line: position.line, character: position.character }
				})
				const newText = `Item		${quote(detail) ? `"${detail}"` : detail}\n${before}`

				return [{
					range: detailRange,
					severity: DiagnosticSeverity.Warning,
					code: "invalid-item",
					source: "popfile",
					message: `TFBot ${canonicalClassName != undefined ? `${canonicalClassName} ` : ""}does not own item "${detail}".${items.length > 0 ? ` Expected ${[...items].map((item) => `"${item}"`).join(" | ")}.` : ""}`,
					data: {
						fix: ({ createDocumentWorkspaceEdit }) => {
							return {
								title: `Add item "${detail}"`,
								edit: createDocumentWorkspaceEdit(TextEdit.insert(position, newText))
							}
						},
					}
				}]
			}

			return []
		}

		const validateItemName = string(reference(Symbol.for("item"), (name, detail, detailRange, documentSymbol, path, context, definitions) => [
			...validateItemNameOwner(name, detail, detailRange, documentSymbol, path, context),
			...validateItemKey(name, detail, detailRange, documentSymbol, path, context, definitions)
		]))

		const validateItemAttributes = (): Validate<PopfileTextDocumentDependencies> => {
			const validate = documentSymbols({ "ItemName": [validateItemName] }, () => [])
			return (key, documentSymbol, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				diagnostics.push(...validate(key, documentSymbol, path, context))

				if (documentSymbol.children) {
					const itemName = documentSymbol.children.find((documentSymbol) => documentSymbol.key.toLowerCase() == "ItemName".toLowerCase() && documentSymbol.detail != undefined)?.detail
					if (itemName == undefined) {
						diagnostics.push({
							range: documentSymbol.nameRange,
							severity: DiagnosticSeverity.Warning,
							code: "missing-itemname",
							source: "popfile",
							message: "ItemAttributes block must include Itemname (TFBotSpawner: need to specify ItemName in ItemAttributes.)",
						})
					}
				}

				return diagnostics
			}
		}

		const dynamicAttributes: Record<string, [Validate<PopfileTextDocumentDependencies>] | [Validate<PopfileTextDocumentDependencies>, KeyDistinct]> = {
			"Attributes": [string(set(values.attributes.values)), KeyDistinct.None],
			"BehaviorModifiers": [string(set(["Mobber", "Push"]))],
			"CharacterAttributes": [documentSymbols({}, () => [])],
			"Item": [validateItem, KeyDistinct.None],
			"ItemAttributes": [validateItemAttributes(), KeyDistinct.None],
			"MaxVisionRange": [string(float), KeyDistinct.Last],
			"Skill": [string(set(values.skill.values)), KeyDistinct.Last],
			// https://github.com/cooolbros/vscode-vdf/pull/72
			"Tag": [string(length(256)), KeyDistinct.None],
			"WeaponRestrictions": [string(set(["MeleeOnly", "PrimaryOnly", "SecondaryOnly"])), KeyDistinct.Last],
		}

		const validateDynamicAttributes = documentSymbols(dynamicAttributes)

		const validateClassIcon = string((name, detail, detailRange, documentSymbol, path, context) => {
			let classIcons = context.dependencies.classIcons.get(detail)
			if (!classIcons) {
				classIcons = []
				context.dependencies.classIcons.set(detail, classIcons)
			}
			classIcons.push(detailRange)
			return []
		})

		const validateTFBot = documentSymbols({
			"AutoJumpMax": [string(float)],
			"AutoJumpMin": [string(float)],
			"Class": [string(set(values.class.values)), KeyDistinct.Last],
			"ClassIcon": [validateClassIcon, KeyDistinct.Last],
			"EventChangeAttributes": [documentSymbols({
				"Default": [validateDynamicAttributes, KeyDistinct.Last]
			}, (documentSymbol, path, context, unknown) => {
				const diagnostics: DiagnosticCodeActions = []
				diagnostics.push(...validateEvent(documentSymbol, path, context, unknown))

				const key = documentSymbol.key.toLowerCase()
				const conditional = documentSymbol.conditional?.toLowerCase()
				const eventChangeAttributes = path.at(-1)!.children!
				const first = eventChangeAttributes.find((documentSymbol) => documentSymbol.key.toLowerCase() == key && documentSymbol.conditional?.toLowerCase() == conditional)!

				if (first != documentSymbol) {
					diagnostics.push({
						range: documentSymbol.nameRange,
						severity: DiagnosticSeverity.Warning,
						code: "duplicate-key",
						source: document.languageId,
						message: `Duplicate key '${first.key}'`,
						relatedInformation: [
							{
								location: {
									uri: document.uri.toString(),
									range: first.nameRange
								},
								message: `${first.key} is declared here.`
							}
						],
						data: {
							fix: ({ createDocumentWorkspaceEdit }) => {
								return {
									title: `Remove duplicate ${documentSymbol.key}`,
									edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
								}
							}
						}
					})
				}

				diagnostics.push(...validateDynamicAttributes(documentSymbol.key, documentSymbol, path, context))
				return diagnostics
			})],
			"Health": [string(integer), KeyDistinct.Last],
			"Name": [string(), KeyDistinct.Last],
			"Scale": [string(float), KeyDistinct.Last],
			"TeleportWhere": [string(dynamic("Where")), KeyDistinct.None],
			"Template": [string(reference(Symbol.for("template"), validateTemplateReference)), KeyDistinct.First],
			...dynamicAttributes,
		})

		const validateSpawner: Validate<PopfileTextDocumentDependencies> = (name, documentSymbol, path, context) => {
			switch (documentSymbol.key.toLowerCase()) {
				case "Mob".toLowerCase():
					return validateMob("Mob", documentSymbol, path, context)
				case "RandomChoice".toLowerCase():
					return validateRandomChoice("RandomChoice", documentSymbol, path, context)
				case "SentryGun".toLowerCase():
					return validateSentryGun("SentryGun", documentSymbol, path, context)
				case "Squad".toLowerCase():
					return validateSquad("Squad", documentSymbol, path, context)
				case "Tank".toLowerCase():
					return validateTank("Tank", documentSymbol, path, context)
				case "TFBot".toLowerCase():
					return validateTFBot("TFBot", documentSymbol, path, context)
				default:
					return [{
						range: documentSymbol.nameRange,
						severity: DiagnosticSeverity.Warning,
						code: "unknown-key",
						source: "popfile",
						message: `Unknown attribute '${documentSymbol.key}' in ${name} definition.`,
						data: createUnknownAttributeCodeAction(documentSymbol, context)
					}]
			}
		}

		const validatePopulator = (): Fallback<PopfileTextDocumentDependencies> => {
			const where = new Set([
				"ClosestPoint".toLowerCase(),
				"Where".toLowerCase(),
			])

			const validateWhere = string(dynamic("Where"))

			const spawners = new Set([
				"Mob",
				"RandomChoice",
				"SentryGun",
				"Squad",
				"Tank",
				"TFBot",
			])

			return (documentSymbol, path, context, unknown): DiagnosticCodeActions => {
				const key = documentSymbol.key.toLowerCase()
				if (where.has(key)) {
					return validateWhere("Where", documentSymbol, path, context)
				}
				else if (spawners.values().some((value) => value.toLowerCase() == key)) {
					if (documentSymbol.children == undefined) {
						return [{
							range: documentSymbol.detailRange!,
							severity: DiagnosticSeverity.Warning,
							code: "invalid-type",
							source: "popfile",
							message: `Invalid ${documentSymbol.key} type.`,
						}]
					}

					const spawner = path.at(-1)!.children!.findLast((i) => spawners.values().some((value) => value.toLowerCase() == i.key.toLowerCase()))
					if (spawner != documentSymbol) {
						return [unreachable(documentSymbol.range)]
					}

					return validateSpawner("" /* unused */, documentSymbol, path, context)
				}
				else {
					return unknown()
				}
			}
		}

		const validateMission = documentSymbols({
			"BeginAtWave": [string(integer)],
			"CooldownTime": [string(float)],
			"DesiredCount": [string(integer)],
			"InitialCooldown": [string(float)],
			"Objective": [string(set(values.objective.values))],
			"RunForThisManyWaves": [string(integer)],
		}, validatePopulator())

		const validateWaitBetweenSpawnsFloat = string(float)

		const validateWaitBetweenSpawns: Validate<PopfileTextDocumentDependencies> = (key, documentSymbol, path, context) => {
			const diagnostics: DiagnosticCodeActions = []
			diagnostics.push(...validateWaitBetweenSpawnsFloat(key, documentSymbol, path, context))

			const children = path.at(-1)!.children!
			const index = children.indexOf(documentSymbol)
			const waitBetweenSpawnsAfterDeath = children.findIndex((i) => i.key.toLowerCase() == "WaitBetweenSpawnsAfterDeath".toLowerCase())
			if (waitBetweenSpawnsAfterDeath != -1 && waitBetweenSpawnsAfterDeath < index) {
				diagnostics.push({
					range: documentSymbol.nameRange,
					severity: DiagnosticSeverity.Warning,
					code: "duplicate-wait",
					source: "popfile",
					message: "Already specified WaitBetweenSpawnsAfterDeath time, WaitBetweenSpawns won't be used.",
				})
			}
			return diagnostics
		}

		const validateWaitBetweenSpawnsAfterDeath: Validate<PopfileTextDocumentDependencies> = (key, documentSymbol, path, context) => {
			const diagnostics: DiagnosticCodeActions = []
			diagnostics.push(...validateWaitBetweenSpawnsFloat(key, documentSymbol, path, context))

			const children = path.at(-1)!.children!
			const index = children.indexOf(documentSymbol)
			const waitBetweenSpawnsAfterDeath = children.findIndex((i) => i.key.toLowerCase() == "WaitBetweenSpawns".toLowerCase())
			if (waitBetweenSpawnsAfterDeath != -1 && waitBetweenSpawnsAfterDeath < index) {
				diagnostics.push({
					range: documentSymbol.nameRange,
					severity: DiagnosticSeverity.Warning,
					code: "duplicate-wait",
					source: "popfile",
					message: "Already specified WaitBetweenSpawns time, WaitBetweenSpawnsAfterDeath won't be used.",
				})
			}
			return diagnostics
		}

		const validateWaitForAll = string(reference(
			Symbol.for("wavespawn"),
			(key, detail, detailRange, documentSymbol, path, context, definitions) => {
				const diagnostics: DiagnosticCodeActions = []

				// WaveSchedule.children == undefined
				if (!context.documentSymbols) {
					console.log(context.documentSymbols)
					return diagnostics
				}

				for (const definition of definitions) {
					const documentSymbol = context.documentSymbols.getDocumentSymbolAtPosition(definition.range.start)!
					const support = documentSymbol.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Support".toLowerCase())?.detail
					if (support != undefined && !["0", "Limited".toLowerCase()].includes(support.toLowerCase())) {
						diagnostics.push({
							range: detailRange,
							severity: DiagnosticSeverity.Warning,
							code: "wavespawn-softlock",
							source: "popfile",
							message: `${key} '${detail}' will cause softlock because ${definition.key} has Support '${support}'`,
						})
					}
				}

				return diagnostics
			}
		))

		const validateSoundFile = document.diagnostics.file("sound", "sound", null)

		const validateSound: RefineString<PopfileTextDocumentDependencies> = (name, detail, detailRange, documentSymbol, path, context) => {
			const { chars, value } = removeSoundChars(detail)
			const definitions = context.definitionReferences.definitions.get(null, Symbol.for("sound"), value)
			if (definitions?.length) {
				return [TextDocumentBase.diagnostics.key(definitions[0].key, value, detailRange, { newText: (name) => `${chars}${name}` })]
			}
			else {
				return validateSoundFile(name, value, detailRange, documentSymbol, path, context)
			}
		}

		const validateWaveSpawnDocumentSymbols = documentSymbols({
			"DoneOutput": [validateOutput],
			"DoneWarningSound": [string(validateSound)],
			"FirstSpawnOutput": [validateOutput],
			"FirstSpawnWarningSound": [string(validateSound)],
			"LastSpawnOutput": [validateOutput],
			"LastSpawnWarningSound": [string(validateSound)],
			"MaxActive": [string(integer)],
			"Name": [string()],
			"RandomSpawn": [string(set(["1"]))],
			"SpawnCount": [string(integer)],
			"StartWaveOutput": [validateOutput],
			"StartWaveWarningSound": [string(validateSound)],
			"Support": [string(set(["1", "Limited"]))],
			"TotalCount": [string(integer)],
			"TotalCurrency": [string(integer)],
			"WaitBeforeStarting": [string(float)],
			"WaitBetweenSpawns": [validateWaitBetweenSpawns],
			"WaitBetweenSpawnsAfterDeath": [validateWaitBetweenSpawnsAfterDeath],
			"WaitForAllDead": [validateWaitForAll],
			"WaitForAllSpawned": [validateWaitForAll],
		}, validatePopulator())

		const validateWaveSpawn: Validate<PopfileTextDocumentDependencies> = (key, documentSymbol, path, context) => {
			const diagnostics: DiagnosticCodeActions = []
			diagnostics.push(...validateWaveSpawnDocumentSymbols(key, documentSymbol, path, context))

			if (documentSymbol.children != undefined) {
				// https://github.com/cooolbros/vscode-vdf/issues/34
				const maxActive = parseInt(documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "MaxActive".toLowerCase())?.detail ?? "")
				const spawnCount = parseInt(documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "SpawnCount".toLowerCase())?.detail ?? "")
				if (!isNaN(maxActive) && !isNaN(spawnCount) && spawnCount > maxActive) {
					diagnostics.push({
						range: documentSymbol.nameRange,
						severity: DiagnosticSeverity.Warning,
						code: "wavespawn-softlock",
						source: "popfile",
						message: `WaveSpawn with MaxActive ${maxActive} and SpawnCount ${spawnCount} will cause softlock`,
					})
				}
			}

			return diagnostics
		}

		return header(
			documentSymbols({
				"AddSentryBusterWhenDamageDealtExceeds": [string(integer)],
				"AddSentryBusterWhenKillCountExceeds": [string(integer)],
				"Advanced": [string(set(["1"]))],
				"CanBotsAttackWhileInSpawnRoom": [string(set(["No"]))],
				"EventPopfile": [string(set(["Halloween"]))],
				"FixedRespawnWaveTime": [string(set(["Yes"]))],
				"IsEndless": [string(set(["1"]))],
				"Mission": [validateMission, KeyDistinct.None],
				"PeriodicSpawn": [any],
				"RandomPlacement": [any],
				"RespawnWaveTime": [string(integer)],
				"StartingCurrency": [string(integer)],
				"Templates": [documentSymbols({}, (documentSymbol, path, context, unknown) => {
					const diagnostics: DiagnosticCodeActions = []
					diagnostics.push(...validateTFBot("template", documentSymbol, path, context))

					const key = documentSymbol.key.toLowerCase()
					const conditional = documentSymbol.conditional?.toLowerCase()
					const first = path.at(-1)!.children!.find((documentSymbol) => documentSymbol.key.toLowerCase() == key && documentSymbol.conditional?.toLowerCase() == conditional)!
					if (first != documentSymbol) {
						diagnostics.push({
							range: documentSymbol.nameRange,
							severity: DiagnosticSeverity.Warning,
							code: "duplicate-key",
							source: "popfile",
							message: `Duplicate key '${first.key}'`,
							relatedInformation: [
								{
									location: {
										uri: document.uri.toString(),
										range: first.nameRange
									},
									message: `${first.key} is declared here.`
								}
							],
							data: {
								fix: ({ createDocumentWorkspaceEdit }) => {
									return {
										title: `Remove duplicate ${documentSymbol.key}`,
										edit: createDocumentWorkspaceEdit(TextEdit.del(documentSymbol.range))
									}
								}
							}
						})
					}

					return diagnostics
				}), TemplatesDistinct],
				"Wave": [documentSymbols({
					"Checkpoint": [string(set(["Yes"]))] /* Unreachable code detected. */,
					"Description": [string()],
					"DoneOutput": [validateOutput],
					"InitWaveOutput": [validateOutput],
					"Sound": [string(validateSound)],
					"StartWaveOutput": [validateOutput],
					"WaitWhenDone": [string(float)],
					"WaveSpawn": [validateWaveSpawn, KeyDistinct.None],
				}), KeyDistinct.None]
			}),
			false
		)
	}
}
