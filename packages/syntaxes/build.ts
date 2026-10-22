import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import yaml from "js-yaml"
import { posix } from "path"
import keys from "server/Popfile/keys.json" with { type: "json" }
import values from "server/Popfile/values.json" with { type: "json" }
import z from "zod"

const SRC = "./src"
const DIST = "./dist"

const PopfileValueSchema = z.object({
	field: z.object({
		one: z.array(z.string()).default([]),
		many: z.array(z.string()).default([]),
	}).default({ one: [], many: [] }).transform((arg) => [...arg.one, ...arg.many]),
	cls: z.object({
		one: z.array(z.string()).default([]),
		many: z.array(z.string()).default([]),
	}).default({ one: [], many: [] }).transform((arg) => [...arg.one, ...arg.many]),
}).transform((arg) => [...arg.field, ...arg.cls])

const preprocessors = {
	popfile: {
		entity_name_type_enum: [...Object.keys(values).map((value) => value.toLowerCase()), "where"],
		keyword: [...Object.entries(keys).flatMap(([k, v]) => [k, ...PopfileValueSchema.parse(v)]).map((value) => value.toLowerCase()), "Default".toLowerCase(), "ItemName".toLowerCase()],
		variable_other_enummember: Object.values(values).flat().map((value) => value.toLowerCase())
	}
}

const map = new Map()

for (const file of readdirSync(SRC).filter((value) => posix.extname(value) == ".yaml")) {
	let text = readFileSync(`${SRC}/${file}`, "utf-8")

	const name = file.split(".")[0]
	if (((file): file is keyof typeof preprocessors => file in preprocessors)(file)) {
		for (const [key, keys] of Object.entries(preprocessors[file])) {
			text = text.replace(`{${key}}`, [...new Set(keys)].toSorted().join("|"))
		}
	}

	map.set(posix.parse(name).name, yaml.load(text))
}

if (!existsSync(DIST)) {
	mkdirSync(DIST)
}

for (const [name, data] of map) {
	writeFileSync(`${DIST}/${name}.json`, `${JSON.stringify(data, null, 4)}\n`)
}
