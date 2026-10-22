import { removeSoundChars } from "common/soundChars"

const defaults = {
	test: (_value: string) => true,
	toDefinition: (reference: string) => reference,
	renameReference: (oldReference: string, newReference: string) => newReference,
}

export const types = Object.freeze(<const>{
	attribute: {
		name: "attribute",
		...defaults,
	},
	border: {
		name: "border",
		...defaults,
	},
	colour: {
		name: "colour",
		...defaults,
		test: (value: string) => !/\d+\s+\d+\s+\d+\s+\d+/.test(value) /* Exclude colour literals */,
	},
	customfontfile: {
		name: "custom font file",
		...defaults,
	},
	element: {
		name: "element",
		...defaults,
	},
	event: {
		name: "event",
		...defaults,
	},
	font: {
		name: "font",
		...defaults,
	},
	gamesound: {
		name: "game sound",
		...defaults,
		toDefinition: (reference: string) => removeSoundChars(reference).value,
		renameReference: (oldReference: string, newReference: string) => `${removeSoundChars(oldReference).chars}${newReference}`
	},
	item_color: {
		name: "item color",
		...defaults,
	},
	item: {
		name: "item",
		...defaults,
	},
	prefab: {
		name: "prefab",
		...defaults,
	},
	quality: {
		name: "quality",
		...defaults,
	},
	rarity: {
		name: "rarity",
		...defaults,
	},
	string: {
		name: "string",
		test: (detail: string): detail is `#${string}` => detail[0] == "#",
		toDefinition: (reference: string) => reference.substring(1),
		toReference: (definition: string) => `#${definition}`,
		renameReference: (oldReference: string, newReference: string) => oldReference[0] == "#" ? `#${newReference}` : newReference,
	},
	surfaceprop: {
		name: "surface property",
		...defaults,
	},
	template: {
		name: "template",
		...defaults,
	},
	wavespawn: {
		name: "wavespawn",
		...defaults,
	},
})

export type DefinitionType = (typeof types)[keyof typeof types]
