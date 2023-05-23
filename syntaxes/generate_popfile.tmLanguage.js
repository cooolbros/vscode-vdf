// @ts-check

const KEYS = require("../extension/lib/server/VDF/Popfile/keys.json")
const VALUES = require("../extension/lib/server/VDF/Popfile/values.json")

function lower(/** @type {string} */str) {
	return str.toLowerCase()
}

function sort_set(iterable) {
	return [...new Set(iterable)].sort()
}

const entity_name_type_enum = sort_set([...Object.keys(VALUES).map(lower), "where"])
const keyword = sort_set(Object.entries(KEYS).flatMap(([k, v]) => [lower(k), ...v.values.map((value) => lower(value.label))]))
const variable_other_enummember = sort_set([...Object.values(VALUES).flatMap((value) => value.values.map(lower)), "spawnbot.*"])

console.log(JSON.stringify({
	"$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
	"name": "Popfile",
	"patterns": [
		{
			"match": "^(\\s?\"?#base\"?)\\s+(\"?.*\"?)$",
			"captures": {
				"1": {
					"name": "keyword.control"
				},
				"2": {
					"name": "string"
				}
			}
		},
		{
			"name": "comment",
			"match": "//.*$"
		},
		{
			"name": "constant.character",
			"match": "\\[.*\\]"
		},
		{
			"name": "string",
			"match": "\".*\""
		},
		{
			"name": "keyword.control",
			"match": "(?i)\\b(Action|Target)\\b"
		},
		{
			"name": "entity.name.type.enum",
			"match": `(?i)\\b(${entity_name_type_enum.join("|")})\\b`
		},
		{
			"name": "keyword",
			"match": `(?i)\\b(${keyword.join(("|"))})\\b`
		},
		{
			"name": "variable.other.enummember",
			"match": `(?i)(?<=\\s)(${variable_other_enummember.join("|")})(?=\\s)`
		},
		{
			"name": "constant.numeric",
			"match": "(?<=\\s)([\\d\\.-]+)(?=\\s)"
		},
		{
			"name": "variable",
			"match": "(?i)(?<=\\s)([a-z\\d_\\\\/\\.']+)(?=\\s)"
		}
	],
	"repository": {},
	"scopeName": "source.popfile"
}, null, "\t"))
