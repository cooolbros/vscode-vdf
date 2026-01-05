import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { waveSpawnKeys } from "common/popfile/waveSpawnKeys"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import type { VSCodeVDFConfiguration } from "common/VSCodeVDFConfiguration"
import { combineLatest, defer, firstValueFrom, from, map, type Observable } from "rxjs"
import type { VDFRange } from "vdf"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import { CompletionItemKind, DiagnosticSeverity, InlayHint, InlayHintKind, InsertTextFormat, TextEdit } from "vscode-languageserver"
import { Collection, type Definition } from "../../DefinitionReferences"
import { TextDocumentBase, type DiagnosticCodeAction, type DiagnosticCodeActions, type DocumentLinkData, type TextDocumentInit } from "../../TextDocumentBase"
import { KeyDistinct, VDFTextDocument, VGUIAssetType, type Context, type Fallback, type Validate, type VDFTextDocumentSchema } from "../VDFTextDocument"
import keys from "./keys.json"
import type { PopfileWorkspace } from "./PopfileWorkspace"
import values from "./values.json"

const sounds = new Set([
	"DoneWarningSound".toLowerCase(),
	"FirstSpawnWarningSound".toLowerCase(),
	"LastSpawnWarningSound".toLowerCase(),
	"Sound".toLowerCase(),
	"StartWaveWarningSound".toLowerCase(),
])

export class PopfileTextDocument extends VDFTextDocument<PopfileTextDocument> {

	public static readonly Schema = (document: PopfileTextDocument): VDFTextDocumentSchema<PopfileTextDocument> => {
		const { unreachable, any, header, string, length, integer, float, set, dynamic, reference } = document.diagnostics

		const createUnknownAttributeCodeAction = (documentSymbol: VDFDocumentSymbol, context: Context<PopfileTextDocument>): DiagnosticCodeAction["data"] => ({
			fix: ({ createDocumentWorkspaceEdit }) => {
				const conditional = context.documentSymbols?.findRecursive((documentSymbol) => {
					return documentSymbol.conditional != null && !TextDocumentBase.conditionals.values().some((conditional) => {
						return conditional.toLowerCase() == documentSymbol.conditional?.toLowerCase()
					})
				})?.conditional

				if (!conditional) {
					return null
				}

				return {
					title: `Add ${conditional}`,
					edit: createDocumentWorkspaceEdit(TextEdit.insert((documentSymbol.detail != undefined ? documentSymbol.range : documentSymbol.nameRange).end, ` ${conditional}`))
				}
			}
		})

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

		const validateSquad: Validate<PopfileTextDocument> = (key, documentSymbol, path, context) => {
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
								title: `Replace Squad with TFBot`,
								edit: createDocumentWorkspaceEdit(TextEdit.replace(documentSymbol.range, document.getText(documentSymbol.children![0]!.range)))
							}
						},
					}
				})
			}

			return diagnostics
		}

		const validateEvent = documentSymbols({
			"Action": [string()],
			"Delay": [string(float)],
			// https://github.com/cooolbros/vscode-vdf/issues/29
			"Param": [string(length(4096))],
			"Target": [string()],
		})

		const validateTank = documentSymbols({
			"Health": [string(integer)],
			"Name": [string()],
			"OnBombDroppedOutput": [validateEvent],
			"OnKilledOutput": [validateEvent],
			"Skin": [string(set(["0", "1"]))],
			"Speed": [string(float)],
			"StartingPathTrackNode": [string()],
		})

		const validateItem = string(reference(Symbol.for("item")))

		const validateItemAttributes = (): Validate<PopfileTextDocument> => {
			const validate = documentSymbols({ "ItemName": [validateItem] }, () => [])
			return (key, documentSymbol, path, context) => {
				const diagnostics: DiagnosticCodeActions = []
				diagnostics.push(...validate(key, documentSymbol, path, context))

				if (documentSymbol.children) {
					const itemName = documentSymbol.children.find((i) => i.key.toLowerCase() == "ItemName".toLowerCase() && i.detail != undefined)
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

		const dynamicAttributes: Record<string, [Validate<PopfileTextDocument>] | [Validate<PopfileTextDocument>, KeyDistinct]> = {
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

		const validateClassIcon = string((name, detail, detailRange, path, context) => {
			return [
				document.workspace.fileSystem.resolveFile(`materials/hud/leaderboard_class_${detail}.vmt`).pipe(
					map((uri) => {
						if (uri != null) {
							return null
						}

						return {
							range: detailRange,
							severity: DiagnosticSeverity.Warning,
							code: "missing-file",
							source: "popfile",
							message: `Cannot find class icon '${detail}'.`,
						}
					})
				),
				// https://github.com/cooolbros/vscode-vdf/issues/62
				document.workspace.classIconFlags(detail).pipe(
					map((vtf) => {
						if (!vtf) {
							return null
						}

						const noMip = (vtf.flags & 256) == 256
						const noLod = (vtf.flags & 512) == 512

						if (noMip && noLod) {
							return null
						}

						return {
							range: detailRange,
							severity: DiagnosticSeverity.Warning,
							code: "missing-vtf-flags",
							source: "popfile",
							message: `ClassIcon '${detail}' does not set VTF flag${!noMip && !noLod ? "s" : ""} ${!noMip ? `"No Mipmap"` : ""}${!noMip && !noLod ? " and " : ""}${!noLod ? `"No Level Of Detail"` : ""}.`,
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
						} satisfies DiagnosticCodeAction
					})
				)
			]
		})

		const validateTFBot = documentSymbols({
			"AutoJumpMax": [string(float)],
			"AutoJumpMin": [string(float)],
			"Class": [string(set(values.class.values)), KeyDistinct.Last],
			"ClassIcon": [validateClassIcon, KeyDistinct.Last],
			"EventChangeAttributes": [documentSymbols({ "Default": [(key, documentSymbol, path, context) => validateTFBot(key, documentSymbol, path, context)] }, (documentSymbol, path, context, unknown) => validateDynamicAttributes(documentSymbol.key, documentSymbol, path, context))],
			"Health": [string(integer), KeyDistinct.Last],
			"Name": [string(), KeyDistinct.Last],
			"Scale": [string(float), KeyDistinct.Last],
			"TeleportWhere": [string(dynamic("Where")), KeyDistinct.None],
			"Template": [string(reference(Symbol.for("template")))],
			...dynamicAttributes,
		})

		const validateSpawner: Validate<PopfileTextDocument> = (name, documentSymbol, path, context) => {
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

		const validatePopulator = (): Fallback<PopfileTextDocument> => {
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

		const validateWaitBetweenSpawns: Validate<PopfileTextDocument> = (key, documentSymbol, path, context) => {
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

		const validateWaitBetweenSpawnsAfterDeath: Validate<PopfileTextDocument> = (key, documentSymbol, path, context) => {
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

		const validateSound = document.diagnostics.file("sound", "sound", null)

		const validateWaveSpawnDocumentSymbols = documentSymbols({
			"DoneOutput": [validateEvent],
			"DoneWarningSound": [string(validateSound)],
			"FirstSpawnOutput": [validateEvent],
			"FirstSpawnWarningSound": [string(validateSound)],
			"LastSpawnOutput": [validateEvent],
			"LastSpawnWarningSound": [string(validateSound)],
			"MaxActive": [string(integer)],
			"Name": [string()],
			"RandomSpawn": [string(set(["1"]))],
			"SpawnCount": [string(integer)],
			"StartWaveOutput": [validateEvent],
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

		const validateWaveSpawn: Validate<PopfileTextDocument> = (key, documentSymbol, path, context) => {
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

		const getDiagnostics = header(
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
				"Templates": [documentSymbols({}, (documentSymbol, path, context, unknown) => validateTFBot("template", documentSymbol, path, context)), KeyDistinct.First],
				"Wave": [documentSymbols({
					"Checkpoint": [string(set(["Yes"]))] /* Unreachable code detected. */,
					"Description": [string()],
					"DoneOutput": [validateEvent],
					"InitWaveOutput": [validateEvent],
					"Sound": [string(validateSound)],
					"StartWaveOutput": [validateEvent],
					"WaitWhenDone": [string(float)],
					"WaveSpawn": [validateWaveSpawn, KeyDistinct.None],
				}), KeyDistinct.None]
			}),
			false
		)

		return {
			keys: keys,
			values: values,
			getDefinitionReferences({ document, documentSymbols }) {
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

				const templates = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "Templates".toLowerCase())?.children ?? []
				for (const documentSymbol of templates.values().filter((documentSymbol) => documentSymbol.children != undefined)) {
					definitions.set(null, template, documentSymbol.key, {
						uri: document.uri,
						key: documentSymbol.key,
						range: documentSymbol.range,
						keyRange: documentSymbol.nameRange,
						nameRange: undefined,
						detail: undefined,
						documentation: document.definitions.documentation(documentSymbol),
						conditional: documentSymbol.conditional ?? undefined,
					})
				}

				for (const [index, documentSymbol] of documentSymbols.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined).entries()) {

					documentSymbol.children!.forEach((documentSymbol) => {
						if (documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
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
				[Symbol.for("item"), { keys: new Set(["Item".toLowerCase(), "ItemName".toLowerCase()]) }],
			]),
			getDiagnostics: getDiagnostics,
			getLinks: ({ documentSymbols, resolve }) => {
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

						if (sounds.has(key) && documentSymbol.detail?.trim() != "") {
							links.push({
								range: documentSymbol.detailRange!,
								data: {
									resolve: async () => await firstValueFrom(document.fileSystem.resolveFile(resolve(`sound/${documentSymbol.detail}`)))
								}
							})
							return
						}
					})
				})

				return links
			},
			getColours: ({ next }) => {
				const set_item_tint_rgb = "set item tint RGB".toLowerCase()
				return next((colours, documentSymbol) => {
					if (documentSymbol.key.toLowerCase() == set_item_tint_rgb && documentSymbol.detail != undefined && /^\d+$/.test(documentSymbol.detail)) {
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
				const paints = await document.workspace.paints
				const set_item_tint_rgb = "set item tint RGB".toLowerCase()
				return documentSymbols.reduce(
					(inlayHints, documentSymbol) => {
						if (!documentSymbol.children) {
							return inlayHints
						}

						inlayHints.push(
							...documentSymbol.children.reduceRecursive(
								<InlayHint[]>[],
								(inlayHints, documentSymbol) => {
									if (documentSymbol.key.toLowerCase() == set_item_tint_rgb && documentSymbol.detail != undefined) {
										if (paints.has(documentSymbol.detail!)) {
											inlayHints.push({
												position: documentSymbol.detailRange!.end,
												label: paints.get(documentSymbol.detail!)!,
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
					},
					{
						keys: sounds,
						folder: "sound",
						extensionsPattern: null,
					}
				],
			}
		}
	}

	public readonly workspace: PopfileWorkspace
	public readonly decorations$: Observable<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>

	constructor(
		init: TextDocumentInit,
		documentConfiguration: Observable<VSCodeVDFConfiguration>,
		fileSystem: FileSystemMountPoint,
		documents: RefCountAsyncDisposableFactory<Uri, PopfileTextDocument>,
		workspace: PopfileWorkspace
	) {
		super(init, documentConfiguration, fileSystem, documents, {
			relativeFolderPath: "scripts/population",
			VDFParserOptions: { multilineStrings: new Set(["Param".toLowerCase(), "Tag".toLowerCase()]) },
			keyTransform: (key) => key,
			dependencies$: combineLatest([
				defer(async () => PopfileTextDocument.Schema(this)),
				from(workspace.dependencies),
				from(workspace.entities(init.uri.basename())),
			]).pipe(
				map(([schema, workspace, entities]) => {
					return {
						schema: {
							...schema,
							keys: {
								...schema.keys,
								...workspace.schema.keys,
							},
							values: {
								...schema.values,
								...entities?.values
							},
							completion: {
								...schema.completion,
								values: {
									...workspace.completion.values,
									...entities?.completion.values,
								}
							}
						} satisfies VDFTextDocumentSchema<PopfileTextDocument>,
						globals$: workspace.globals$
					}
				})
			)
		})

		this.workspace = workspace

		this.decorations$ = this.documentSymbols$.pipe(
			map((documentSymbols) => {
				const waveSchedule = documentSymbols.find((documentSymbol) => documentSymbol.key != "#base" && documentSymbol)?.children
				if (!waveSchedule) {
					return []
				}

				return waveSchedule.reduce(
					(decorations, documentSymbol) => {
						if (documentSymbol.key.toLowerCase() == "Wave".toLowerCase() && documentSymbol.children != undefined) {
							const currency = documentSymbol.children.reduce(
								(currency, documentSymbol) => {
									if (documentSymbol.key.toLowerCase() == "WaveSpawn".toLowerCase() && documentSymbol.children != undefined) {
										const totalCurrency = parseInt(documentSymbol.children.findLast((documentSymbol) => documentSymbol.key.toLowerCase() == "TotalCurrency".toLowerCase())?.detail ?? "")
										if (!isNaN(totalCurrency)) {
											currency += totalCurrency
										}
									}
									return currency
								},
								0
							)

							decorations.push({
								range: documentSymbol.nameRange,
								renderOptions: {
									after: {
										contentText: `${decorations.length + 1} $${currency}`
									}
								}
							})
						}
						return decorations
					},
					<{ range: VDFRange, renderOptions: { after: { contentText: string } } }[]>[]
				)
			})
		)
	}
}
