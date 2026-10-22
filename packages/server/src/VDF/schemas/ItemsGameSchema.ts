import { resolvePath } from "common/resolvePath"
import { posix } from "path"
import { firstValueFrom, map, switchMap } from "rxjs"
import { VDFRange } from "vdf"
import { VDFDocumentSymbols, type VDFDocumentSymbol, type VDFText } from "vdf-documentsymbols"
import { MarkupKind, type InlayHint } from "vscode-languageserver"
import { Collection, Definitions, type Definition } from "../../DefinitionReferences"
import { types, type DefinitionType } from "../../DefinitionTypes"
import type { DocumentLinkResolve } from "../../TextDocumentBase"
import type { VDFTextDocument, VDFTextDocumentSchema } from "../VDFTextDocument"

type ItemsGameAction = (documentSymbol: VDFDocumentSymbol, index: number) => void

interface ItemsGameActions {
	game_info: ItemsGameAction
	qualities: ItemsGameAction
	colors: ItemsGameAction
	rarities: ItemsGameAction
	equip_regions_list: ItemsGameAction
	equip_conflicts: ItemsGameAction
	quest_objective_conditions: ItemsGameAction
	item_series_types: ItemsGameAction
	item_collections: ItemsGameAction
	operations: ItemsGameAction
	prefabs: ItemsGameAction
	items: ItemsGameAction
	attributes: ItemsGameAction
	item_criteria_templates: ItemsGameAction
	random_attribute_templates: ItemsGameAction
	lootlist_job_template_definitions: ItemsGameAction
	item_sets: ItemsGameAction
	client_loot_lists: ItemsGameAction
	revolving_loot_lists: ItemsGameAction
	recipes: ItemsGameAction
	achievement_rewards: ItemsGameAction
	attribute_controlled_attached_particles: ItemsGameAction
	armory_data: ItemsGameAction
	item_levels: ItemsGameAction
	kill_eater_score_types: ItemsGameAction
	mvm_maps: ItemsGameAction
	mvm_tours: ItemsGameAction
	matchmaking_categories: ItemsGameAction
	maps: ItemsGameAction
	master_maps_list: ItemsGameAction
	steam_packages: ItemsGameAction
	string_lookups: ItemsGameAction
	community_market_item_remaps: ItemsGameAction
	war_definitions: ItemsGameAction
}

function ItemsGameForEach(documentSymbols: VDFDocumentSymbols, callbacks: Partial<ItemsGameActions>) {
	for (const documentSymbol of documentSymbols) {
		if (documentSymbol.children == undefined) {
			continue
		}

		const key = documentSymbol.key.text.toLowerCase()
		if (((key): key is keyof typeof callbacks => key in callbacks)(key)) {
			documentSymbol.children.forEach((documentSymbol, index) => callbacks[key]?.(documentSymbol, index))
		}
	}
}

export const ItemsGameSchema = (document: VDFTextDocument) => {
	return {
		id: <const>"items-game",
		name: <const>"Items Game",
		definitionTypes: [],
		content$: document.documentSymbols$.pipe(
			map((documentSymbols) => {
				const scopes = new Map<DefinitionType, Map<number, VDFRange[]>>()
				const definitions = new Collection<Definition>()
				const references = new Collection<VDFText>()

				const languageToken = (documentSymbol: VDFDocumentSymbol) => {
					if (documentSymbol.value != undefined) {
						references.set(null, types.string, types.string.test(documentSymbol.value.text) ? types.string.toDefinition(documentSymbol.value.text) : documentSymbol.value.text, documentSymbol.value)
					}
				}

				const prefab = (documentSymbol: VDFDocumentSymbol) => {
					if (documentSymbol.value != undefined) {
						for (const match of documentSymbol.value.text.matchAll(/\w+/g)) {
							const character = documentSymbol.value.range.start.character
							const prefabReference = match[0]
							const start = match.index
							const startPosition = documentSymbol.value.range.start.with({ character: character + start })
							const endPosition = documentSymbol.value.range.start.with({ character: character + start + prefabReference.length })
							const range = new VDFRange(startPosition, endPosition)
							references.set(null, types.prefab, prefabReference, { text: prefabReference, range: range, tokenRange: range, quoted: false })
						}
					}
				}

				const visuals = (documentSymbol: VDFDocumentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "styles": {
								for (const index of documentSymbol.children ?? []) {
									for (const documentSymbol of index.children ?? []) {
										switch (documentSymbol.key.text.toLowerCase()) {
											case "name": {
												languageToken(documentSymbol)
												break
											}
										}
									}
								}
								break
							}
						}
					}
				}

				ItemsGameForEach(documentSymbols[0].children ?? new VDFDocumentSymbols(), {
					qualities: (documentSymbol) => {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.quality, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: undefined,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: { label: documentSymbol.key.text, documentation: { kind: MarkupKind.Markdown, value: documentation } }
						})
					},
					colors: (documentSymbol) => {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.item_color, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: undefined,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: { label: documentSymbol.key.text, documentation: { kind: MarkupKind.Markdown, value: documentation } }
						})

						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "color_name": {
									if (documentSymbol.value != undefined) {
										references.set(null, types.colour, documentSymbol.value.text, documentSymbol.value)
									}
									break
								}
							}
						}
					},
					rarities: (documentSymbol) => {
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.rarity, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: undefined,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: { label: documentSymbol.key.text, documentation: { kind: MarkupKind.Markdown, value: documentation } }
						})

						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "loc_key":
								case "loc_key_weapon": {
									languageToken(documentSymbol)
									break
								}
								case "color": {
									if (documentSymbol.value != undefined) {
										references.set(null, types.item_color, documentSymbol.value.text, documentSymbol.value)
									}
									break
								}
								case "next_rarity": {
									if (documentSymbol.value != undefined) {
										references.set(null, types.rarity, documentSymbol.value.text, documentSymbol.value)
									}
								}
							}
						}
					},
					item_collections: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "description":
								case "name": {
									languageToken(documentSymbol)
								}
							}
						}
					},
					prefabs: (documentSymbol) => {
						// "public_prefab"
						const documentation = document.definitions.documentation(documentSymbol)
						definitions.set(null, types.prefab, documentSymbol.key.text, {
							uri: document.uri,
							key: documentSymbol.key.text,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: undefined,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: {
								label: documentSymbol.key.text,
								documentation: { kind: MarkupKind.Markdown, value: documentation }
							}
						})

						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "prefab": {
									prefab(documentSymbol)
									break
								}
								case "static_attrs": {
									const children = documentSymbol.children ?? []
									for (const documentSymbol of children) {
										switch (documentSymbol.key.text.toLowerCase()) {
											case "meter_label": {
												languageToken(documentSymbol)
												break
											}
										}
									}
									break
								}
								case "item_name":
								case "item_description":
								case "item_type_name": {
									languageToken(documentSymbol)
									break
								}
								case "item_quality": {
									if (documentSymbol.value != undefined) {
										references.set(null, types.quality, documentSymbol.value.text, documentSymbol.value)
									}
									break
								}
								case "visuals": {
									visuals(documentSymbol)
									break
								}
								case "tool": {
									const children = documentSymbol.children ?? []
									for (const documentSymbol of children) {
										switch (documentSymbol.key.text.toLowerCase()) {
											case "usage": {
												const children = documentSymbol.children ?? []
												for (const documentSymbol of children) {
													switch (documentSymbol.key.text.toLowerCase()) {
														case "item_desc_tool_target": {
															languageToken(documentSymbol)
															break
														}
													}
												}
												break
											}
											case "use_string": {
												languageToken(documentSymbol)
												break
											}
										}
									}
									break
								}
							}
						}
					},
					items: (documentSymbol, index) => {
						if (index != 0 /* "default" */) {
							if (!documentSymbol.children) {
								return
							}

							const name = documentSymbol.children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "name")!
							const documentation = document.definitions.documentation(documentSymbol)

							const image_inventory = documentSymbol.children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "image_inventory")?.value?.text
							const data = image_inventory != undefined
								? { image: { uri: document.uri, path: posix.join("materials", `${image_inventory}.vmt`) } }
								: undefined

							definitions.set(null, types.item, name.value!.text, {
								uri: document.uri,
								key: name.value!.text,
								range: documentSymbol.range,
								keyToken: documentSymbol.key,
								nameToken: undefined,
								detail: undefined,
								documentation: { kind: MarkupKind.Markdown, value: documentation },
								conditional: documentSymbol.conditional ?? undefined,
								completionItem: {
									label: name.value!.text,
									documentation: { kind: MarkupKind.Markdown, value: documentation },
									data: data
								}
							})
						}

						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "prefab": {
									prefab(documentSymbol)
									break
								}
								case "event_desc_footer":
								case "item_name":
								case "item_type_name":
								case "visuals": {
									languageToken(documentSymbol)
									break
								}
								case "static_attrs": {
									const children = documentSymbol.children ?? []
									for (const documentSymbol of children) {
										switch (documentSymbol.key.text.toLowerCase()) {
											case "meter_label":
											case "item name text override":
											case "random drop line item footer desc": {
												languageToken(documentSymbol)
												break
											}
										}
									}
									break
								}
								case "item_quality": {
									if (documentSymbol.value != undefined) {
										references.set(null, types.quality, documentSymbol.value.text, documentSymbol.value)
									}
									break
								}
							}
						}
					},
					attributes: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						const name = children.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "name")!.value!.text
						const documentation = document.definitions.documentation(documentSymbol)

						definitions.set(null, types.attribute, name, {
							uri: document.uri,
							key: name,
							range: documentSymbol.range,
							keyToken: documentSymbol.key,
							nameToken: undefined,
							detail: undefined,
							documentation: { kind: MarkupKind.Markdown, value: documentation },
							conditional: documentSymbol.conditional ?? undefined,
							completionItem: { label: name, documentation: { kind: MarkupKind.Markdown, value: documentation } }
						})

						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "description_string": {
									languageToken(documentSymbol)
								}
							}
						}
					},
					recipes: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "name":
								case "n_A":
								case "desc_inputs":
								case "desc_outputs":
								case "di_A":
								case "di_B":
								case "di_C":
								case "do_A":
								case "do_B":
								case "do_C": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					armory_data: (documentSymbol) => {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "armory_item_classes":
							case "armory_attributes":
							case "armory_items": {
								const children = documentSymbol.children ?? []
								for (const documentSymbol of children) {
									languageToken(documentSymbol)
								}
							}
						}
					},
					mvm_maps: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "display_name": {
									languageToken(documentSymbol)
									break
								}
								case "missions": {
									for (const mission of documentSymbol.children ?? []) {
										for (const documentSymbol of mission.children ?? []) {
											switch (documentSymbol.key.text.toLowerCase()) {
												case "display_name":
												case "mode":
													languageToken(documentSymbol)
													break
											}
										}
									}
									break
								}
							}
						}
					},
					mvm_tours: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "tour_name": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					matchmaking_categories: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "localized_name": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					maps: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "localized_name":
								case "localized_desc": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					master_maps_list: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "localizedname":
								case "strangeprefixtoken":
								case "authors": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					steam_packages: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							switch (documentSymbol.key.text.toLowerCase()) {
								case "localization_key": {
									languageToken(documentSymbol)
									break
								}
							}
						}
					},
					string_lookups: (documentSymbol) => {
						const children = documentSymbol.children ?? []
						for (const documentSymbol of children) {
							languageToken(documentSymbol)
						}
					}
				})

				return {
					documentSymbols: documentSymbols,
					definitionReferences: {
						scopes: scopes,
						definitions: new Definitions([document.version], definitions),
						references: references,
					}
				}
			})
		),
		getDiagnostics: (_diagnostics, _context) => {
			// items_game.txt does not use #base
			// items_game.txt is readonly
		},
		getDocumentLinks: async () => {
			const documentSymbols = await firstValueFrom(document.documentSymbols$)
			const items_game = documentSymbols.find((documentSymbol) => documentSymbol.key.text.toLowerCase() == "items_game")?.children ?? new VDFDocumentSymbols()
			const documentLinks: DocumentLinkResolve[] = []

			const link = (folder?: string, extension?: `.${string}`) => {
				return (documentSymbol: VDFDocumentSymbol) => {
					if (documentSymbol.value?.text.trim().length) {
						documentLinks.push({
							range: documentSymbol.value.range!,
							data: {
								resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolvePath(`${folder != undefined ? `${folder}/` : ""}${documentSymbol.value!.text}`, extension)))).uri
							}
						})
					}
				}
			}

			const file = link()
			const material = link("materials", ".vmt")
			const vgui = link("materials/vgui", ".vmt")
			const sound = link("sound")

			const visuals = (documentSymbol: VDFDocumentSymbol) => {
				const children = documentSymbol.children ?? []
				for (const documentSymbol of children) {
					switch (documentSymbol.key.text.toLowerCase()) {
						case "styles": {
							for (const index of documentSymbol.children ?? []) {
								for (const documentSymbol of index.children ?? []) {
									switch (documentSymbol.key.text.toLowerCase()) {
										case "model_player_per_class":
											const children = documentSymbol.children ?? []
											for (const documentSymbol of children) {
												// basename %s
												if (documentSymbol.key.text.toLowerCase() != "basename") {
													file(documentSymbol)
												}
											}
											break
										case "image_inventory": {
											material(documentSymbol)
											break
										}
										case "model_player": {
											file(documentSymbol)
											break
										}
									}
								}
							}
							break
						}
						case "attached_models":
						case "attached_models_festive": {
							for (const index of documentSymbol.children ?? []) {
								for (const documentSymbol of index.children ?? []) {
									switch (documentSymbol.key.text.toLowerCase()) {
										case "model": {
											file(documentSymbol)
											break
										}
									}
								}
							}
						}
					}
				}
			}

			ItemsGameForEach(items_game, {
				operations: (documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "quest_log_res_file":
							case "quest_list_res_file":
								file(documentSymbol)
								break
						}
					}
				},
				prefabs: (documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "static_attrs": {
								const children = documentSymbol.children ?? []
								for (const documentSymbol of children) {
									switch (documentSymbol.key.text.toLowerCase()) {
										case "weapon_uses_stattrak_module": {
											file(documentSymbol)
											break
										}
									}
								}
								break
							}
							case "image_inventory":
							case "image_inventory_overlay":
							case "image_inventory_overlay2":
								material(documentSymbol)
								break
							case "drop_sound":
							case "mouse_pressed_sound":
							case "recipe_complete_sound":
							case "recipe_partial_complete_sound":
								sound(documentSymbol)
								break
							case "model_player":
							case "qc_template":
								file(documentSymbol)
								break
							case "model_player_per_class":
								const children = documentSymbol.children ?? []
								for (const documentSymbol of children) {
									file(documentSymbol)
								}
								break
							case "visuals": {
								visuals(documentSymbol)
								break
							}
						}
					}
				},
				items: (documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "image_inventory": {
								material(documentSymbol)
								break
							}
							case "model_player_per_class": {
								const children = documentSymbol.children ?? []
								for (const documentSymbol of children) {
									// basename %s
									if (documentSymbol.key.text.toLowerCase() != "basename") {
										file(documentSymbol)
									}
								}
								break
							}
							case "mouse_pressed_sound":
							case "drop_sound":
								sound(documentSymbol)
								break
							case "model_player":
								file(documentSymbol)
								break
							case "visuals":
							case "visuals_red":
							case "visuals_blu":
								visuals(documentSymbol)
								break
						}
					}
				},
				mvm_tours: (documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "loot_image": {
								vgui(documentSymbol)
								break
							}
						}
					}
				},
				maps: (documentSymbol) => {
					const children = documentSymbol.children ?? []
					for (const documentSymbol of children) {
						switch (documentSymbol.key.text.toLowerCase()) {
							case "list_image": {
								vgui(documentSymbol)
								break
							}
						}
					}
				}
			})

			return documentLinks
		},
		getDocumentColor: async () => {
			return []
		},
		onInlayHint: async (params) => {
			const definitions = await firstValueFrom(document.data$.pipe(switchMap((data) => data.globals.get("languageTokens").definitions$)))
			const references = document.references.collection$.value

			return references
				.ofType(null, types.string)
				.entries()
				.flatMap(([key, references]) => {
					const definition = definitions.get(null, types.string, key)
					if (!definition) {
						return []
					}

					return references
						.values()
						.filter((reference) => params.range.contains(reference.range))
						.map((reference) => {
							return <InlayHint>{
								position: reference.range.end,
								label: [definition[0].inlayHintLabel!],
								paddingLeft: true,
							}
						})
				})
				.toArray()
		},
		completion: {
			keys: async () => null,
			values: async () => null,
		}
	} satisfies VDFTextDocumentSchema
}
