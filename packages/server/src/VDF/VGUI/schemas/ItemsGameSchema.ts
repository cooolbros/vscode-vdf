import { posix } from "path"
import { firstValueFrom } from "rxjs"
import { VDFRange } from "vdf"
import type { VDFDocumentSymbol } from "vdf-documentsymbols"
import type { InlayHint } from "vscode-languageserver"
import { Collection, type Definition } from "../../../DefinitionReferences"
import type { DocumentLinkData } from "../../../TextDocumentBase"
import { type VDFTextDocumentSchema } from "../../VDFTextDocument"
import type { VGUITextDocument, VGUITextDocumentDependencies } from "../VGUITextDocument"

export const ItemsGameSchema = (document: VGUITextDocument): VDFTextDocumentSchema<VGUITextDocumentDependencies> => {
	return {
		keys: {},
		values: {},
		getDefinitionReferences: (params) => {
			const scopes = new Map<symbol, Map<number, VDFRange>>()
			const definitions = new Collection<Definition>()
			const references = new Collection<VDFRange>()

			const map = Map.groupBy(params.getHeader(), (documentSymbol) => documentSymbol.key.toLowerCase())

			const string = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol?.detail != undefined) {
					references.set(null, Symbol.for("string"), documentSymbol.detail.startsWith("#") ? documentSymbol.detail.substring(1) : documentSymbol.detail, documentSymbol.detailRange!)
				}
			}

			const visuals = (documentSymbol: VDFDocumentSymbol) => {
				const children = documentSymbol.children ?? []
				for (const documentSymbol of children) {
					switch (documentSymbol.key.toLowerCase()) {
						case "styles": {
							for (const index of documentSymbol.children ?? []) {
								for (const documentSymbol of index.children ?? []) {
									switch (documentSymbol.key.toLowerCase()) {
										case "name": {
											string(documentSymbol)
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

			// "qualities"
			for (const quality of map.get("qualities")?.[0].children ?? []) {
				definitions.set(null, Symbol.for("quality"), quality.key, {
					uri: document.uri,
					key: quality.key,
					range: quality.range,
					keyRange: quality.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(quality),
					conditional: quality.conditional ?? undefined,
				})
			}

			// "colors"
			for (const color of map.get("colors")?.[0].children ?? []) {
				definitions.set(null, Symbol.for("item_color"), color.key, {
					uri: document.uri,
					key: color.key,
					range: color.range,
					keyRange: color.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(color),
					conditional: color.conditional ?? undefined,
				})

				for (const documentSymbol of color.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "color_name": {
							if (documentSymbol?.detail != undefined) {
								references.set(null, Symbol.for("color"), documentSymbol.detail, documentSymbol.detailRange!)
							}
							break
						}
					}
				}
			}

			// "rarities"
			for (const rarity of map.get("rarities")?.[0].children ?? []) {
				definitions.set(null, Symbol.for("rarity"), rarity.key, {
					uri: document.uri,
					key: rarity.key,
					range: rarity.range,
					keyRange: rarity.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(rarity),
					conditional: rarity.conditional ?? undefined,
				})

				for (const documentSymbol of rarity.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "loc_key":
						case "loc_key_weapon": {
							string(documentSymbol)
							break
						}
						case "color": {
							if (documentSymbol.detail != undefined) {
								references.set(null, Symbol.for("item_color"), documentSymbol.detail, documentSymbol.detailRange!)
							}
							break
						}
						case "next_rarity": {
							if (documentSymbol?.detail != undefined) {
								references.set(null, Symbol.for("rarity"), documentSymbol.detail, documentSymbol.detailRange!)
							}
						}
					}
				}
			}

			// "item_collections"
			for (const item_collection of map.get("item_collections")?.[0].children ?? []) {
				for (const documentSymbol of item_collection.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "description":
						case "name": {
							string(documentSymbol)
						}
					}
				}
			}

			// "prefabs"
			for (const prefab of map.get("prefabs")?.[0].children ?? []) {

				// "public_prefab"
				definitions.set(null, Symbol.for("prefab"), prefab.key, {
					uri: document.uri,
					key: prefab.key,
					range: prefab.range,
					keyRange: prefab.nameRange,
					nameRange: undefined,
					detail: undefined,
					documentation: document.definitions.documentation(prefab),
					conditional: prefab.conditional ?? undefined,
				})

				for (const documentSymbol of prefab.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "prefab": {
							if (documentSymbol?.detail != undefined && documentSymbol?.detailRange != undefined) {
								for (const match of documentSymbol.detail.matchAll(/\w+/g)) {
									const character = documentSymbol.detailRange.start.character
									const prefabReference = match[0]
									const start = match.index
									const startPosition = documentSymbol.detailRange.start.with({ character: character + start })
									const endPosition = documentSymbol.detailRange.start.with({ character: character + start + prefabReference.length })
									references.set(null, Symbol.for("prefab"), prefabReference, new VDFRange(startPosition, endPosition))
								}
							}
							break
						}
						case "item_name":
						case "item_description":
						case "item_type_name": {
							string(documentSymbol)
							break
						}
						case "item_quality": {
							if (documentSymbol?.detail != undefined) {
								references.set(null, Symbol.for("quality"), documentSymbol.detail, documentSymbol.detailRange!)
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
								switch (documentSymbol.key.toLowerCase()) {
									case "usage": {
										const children = documentSymbol.children ?? []
										for (const documentSymbol of children) {
											switch (documentSymbol.key.toLowerCase()) {
												case "item_desc_tool_target": {
													string(documentSymbol)
													break
												}
											}
										}
										break
									}
									case "use_string": {
										string(documentSymbol)
										break
									}
								}
							}
							break
						}
					}
				}
			}

			// "items"
			for (const [index, item] of map.get("items")?.[0].children?.entries() ?? []) {
				if (index != 0 /* "default" */) {
					const name = item.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "name")!

					const image_inventory = item.children?.find((documentSymbol) => documentSymbol.key.toLowerCase() == "image_inventory")?.detail
					const data = image_inventory != undefined
						? { image: { uri: document.uri, path: posix.join("materials", `${image_inventory}.vmt`) } }
						: undefined

					definitions.set(null, Symbol.for("item"), name.detail!, {
						uri: document.uri,
						key: name.detail!,
						range: item.range,
						keyRange: item.nameRange,
						nameRange: undefined,
						detail: undefined,
						documentation: document.definitions.documentation(item, "vdf"),
						conditional: item.conditional ?? undefined,
						completionItem: {
							data: data
						}
					})
				}

				for (const documentSymbol of item.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "prefab": {
							if (documentSymbol?.detail != undefined && documentSymbol?.detailRange != undefined) {
								for (const match of documentSymbol.detail.matchAll(/\w+/g)) {
									const character = documentSymbol.detailRange.start.character
									const prefabReference = match[0]
									const start = match.index
									const startPosition = documentSymbol.detailRange.start.with({ character: character + start })
									const endPosition = documentSymbol.detailRange.start.with({ character: character + start + prefabReference.length })
									references.set(null, Symbol.for("prefab"), prefabReference, new VDFRange(startPosition, endPosition))
								}
							}
							break
						}
						case "item_name":
						case "item_type_name": {
							string(documentSymbol)
							break
						}
						case "static_attrs": {
							const children = documentSymbol.children ?? []
							for (const documentSymbol of children) {
								switch (documentSymbol.key.toLowerCase()) {
									case "meter_label": {
										string(documentSymbol)
										break
									}
								}
							}
							break
						}
						case "item_quality": {
							if (documentSymbol?.detail != undefined) {
								references.set(null, Symbol.for("quality"), documentSymbol.detail, documentSymbol.detailRange!)
							}
							break
						}
						case "visuals": {
							visuals(documentSymbol)
							break
						}
					}
				}
			}

			// "attributes"
			for (const attribute of map.get("attributes")?.[0].children?.values() ?? []) {
				for (const documentSymbol of attribute.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "description_string": {
							string(documentSymbol)
						}
					}
				}
			}

			// "recipes"
			for (const recipe of map.get("recipes")?.[0].children?.values() ?? []) {
				for (const documentSymbol of recipe.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
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
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "armory_data"
			for (const armory_data of map.get("armory_data")?.[0].children?.values() ?? []) {
				switch (armory_data.key.toLowerCase()) {
					case "armory_item_classes":
					case "armory_attributes":
					case "armory_items": {
						const children = armory_data.children ?? []
						for (const documentSymbol of children) {
							string(documentSymbol)
						}
					}
				}
			}

			// "mvm_maps"
			for (const mvm_map of map.get("mvm_maps")?.[0].children?.values() ?? []) {
				for (const documentSymbol of mvm_map.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "display_name": {
							string(documentSymbol)
							break
						}
						case "missions": {
							for (const mission of documentSymbol.children ?? []) {
								for (const documentSymbol of mission.children ?? []) {
									switch (documentSymbol.key.toLowerCase()) {
										case "display_name":
										case "mode":
											string(documentSymbol)
											break
									}
								}
							}
							break
						}
					}
				}
			}

			// "mvm_tours"
			for (const mvm_tour of map.get("mvm_tours")?.[0].children?.values() ?? []) {
				for (const documentSymbol of mvm_tour.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "tour_name": {
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "matchmaking_categories"
			for (const matchmaking_category of map.get("matchmaking_categories")?.[0].children?.values() ?? []) {
				for (const documentSymbol of matchmaking_category.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "localized_name": {
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "maps"
			for (const map_ of map.get("maps")?.[0].children?.values() ?? []) {
				for (const documentSymbol of map_.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "localized_name":
						case "localized_desc": {
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "master_maps_list"
			for (const master_map of map.get("master_maps_list")?.[0].children ?? []) {
				for (const documentSymbol of master_map.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "localizedname":
						case "strangeprefixtoken":
						case "authors": {
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "steam_packages"
			for (const steam_package of map.get("steam_packages")?.[0].children ?? []) {
				for (const documentSymbol of steam_package.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "localization_key": {
							string(documentSymbol)
							break
						}
					}
				}
			}

			// "string_lookups"
			for (const string_lookup of map.get("string_lookups")?.[0].children ?? []) {
				for (const documentSymbol of string_lookup.children ?? []) {
					string(documentSymbol)
				}
			}

			return {
				scopes: scopes,
				definitions: definitions,
				references: references,
			}
		},
		definitionReferences: new Map(),
		getDiagnostics: (params) => {
			return []
		},
		getLinks: async ({ documentSymbols, resolve }) => {
			const items_game = documentSymbols.find((documentSymbol) => documentSymbol.key.toLowerCase() == "items_game")?.children
			if (!items_game) {
				return []
			}

			const map = Map.groupBy(items_game, (documentSymbol) => documentSymbol.key.toLowerCase())
			const links: DocumentLinkData[] = []

			const file = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail?.length) {
					links.push({
						range: documentSymbol.detailRange!,
						data: {
							resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolve(documentSymbol.detail!)))).uri
						}
					})
				}
			}

			const material = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail?.length) {
					links.push({
						range: documentSymbol.detailRange!,
						data: {
							resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolve(`materials/${documentSymbol.detail}`, ".vmt")))).uri
						}
					})
				}
			}

			const material_vgui = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail?.length) {
					links.push({
						range: documentSymbol.detailRange!,
						data: {
							resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolve(`materials/vgui/${documentSymbol.detail}`, ".vmt")))).uri
						}
					})
				}
			}

			const sound = (documentSymbol: VDFDocumentSymbol) => {
				if (documentSymbol.detail?.length) {
					links.push({
						range: documentSymbol.detailRange!,
						data: {
							resolve: async () => (await firstValueFrom(document.fileSystem.resolve(resolve(`sound/${documentSymbol.detail}`)))).uri
						}
					})
				}
			}

			const visuals = (documentSymbol: VDFDocumentSymbol) => {
				const children = documentSymbol.children ?? []
				for (const documentSymbol of children) {
					switch (documentSymbol.key.toLowerCase()) {
						case "styles": {
							for (const index of documentSymbol.children ?? []) {
								for (const documentSymbol of index.children ?? []) {
									switch (documentSymbol.key.toLowerCase()) {
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
									switch (documentSymbol.key.toLowerCase()) {
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

			// "operations"
			for (const operation of map.get("operations")?.[0].children ?? []) {
				for (const documentSymbol of operation.children ?? []) {
					const key = documentSymbol.key.toLowerCase()
					if (key == "quest_log_res_file" || key == "quest_list_res_file") {
						file(documentSymbol)
					}
				}
			}

			// "prefabs"
			for (const prefab of map.get("prefabs")?.[0].children ?? []) {
				for (const documentSymbol of prefab.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
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
			}

			// "items"
			for (const item of map.get("items")?.[0].children ?? []) {
				for (const documentSymbol of item.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "image_inventory": {
							material(documentSymbol)
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
			}

			// "prefabs"
			// image_inventory
			// qc_template
			// item_type_name
			// mouse_pressed_sound
			// drop_sound
			// item_description
			// image_inventory
			// model_player_per_class

			// "mvm_tours"
			for (const mvm_tour of map.get("mvm_tours")?.[0].children ?? []) {
				for (const documentSymbol of mvm_tour.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "loot_image": {
							material_vgui(documentSymbol)
							break
						}
					}
				}
			}

			// "maps"
			for (const map_ of map.get("maps")?.[0].children ?? []) {
				for (const documentSymbol of map_.children ?? []) {
					switch (documentSymbol.key.toLowerCase()) {
						case "list_image": {
							material_vgui(documentSymbol)
							break
						}
					}
				}
			}

			return links
		},
		getColours: (params) => {
			return []
		},
		getInlayHints: async ({ dependencies, documentSymbols }) => {
			const definitionReferences = await firstValueFrom(document.definitionReferences$)
			const definitions = definitionReferences.definitions.ofType(null, Symbol.for("string"))

			return definitionReferences.references.collection
				.ofType(null, Symbol.for("string"))
				.entries()
				.flatMap(([key, ranges]) => {
					const detail = definitions.get(key)?.[0].detail
					if (!detail) {
						return []
					}

					return ranges.map((range) => ({
						position: range.end,
						label: detail,
						paddingLeft: true,
					} as InlayHint))
				})
				.toArray()
		},
		completion: {
			root: [],
			typeKey: null,
			defaultType: null,
			files: [],
		}
	}
}
