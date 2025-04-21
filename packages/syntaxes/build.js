import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import yaml from "js-yaml"
import { posix } from "path"
import keys from "server/VDF/Popfile/keys.json" with { type: "json" }
import values from "server/VDF/Popfile/values.json" with { type: "json" }

const SRC = "./src"
const DIST = "./dist"

const preprocessors = {
	popfile: {
		entity_name_type_enum: [...Object.keys(values).map((value) => value.toLowerCase()), "where"],
		keyword: [...Object.entries(keys).flatMap(([k, v]) => [k, ...(v.values ?? []).map((value) => value.label)]).map((value) => value.toLowerCase()), "ItemName".toLowerCase()],
		variable_other_enummember: Object.values(values).flatMap((value) => value.values).map((value) => value.toLowerCase())
	}
}

const map = new Map()

for (const name of readdirSync(SRC).filter((value) => posix.extname(value) == ".yaml")) {
	let text = readFileSync(`${SRC}/${name}`, "utf-8")

	const preprocessor = preprocessors[name.split(".")[0]]
	if (preprocessor) {
		for (const key in preprocessor) {
			text = text.replace(`{${key}}`, [...new Set(preprocessor[key])].toSorted().join("|"))
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
