import functools
import json

JSON_AUTOCOMPLETION_PATH = "../servers/popfile/src/JSON/autocompletion"
KEYS = json.load(open(f"{JSON_AUTOCOMPLETION_PATH}/keys.json"))
VALUES = json.load(open(f"{JSON_AUTOCOMPLETION_PATH}/values.json"))

entity_name_type_enum = sorted(set(map(lambda i: i.lower(), VALUES.keys())))
keyword = sorted(functools.reduce(lambda a, b: a.union(list([b[0].lower()]) + list(map(lambda i: (i[1:] if i.startswith("~") else i).lower(), b[1]))), KEYS.items(), set()))[2:]
variable_other_enummember = sorted(list(functools.reduce(lambda a, b: a.union(b), map(lambda i: map(lambda i: i.lower(), i), VALUES.values()), set())) + list(["spawnbot.*"]))

print(json.dumps({
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
            "match": f"(?i)\\b({'|'.join(entity_name_type_enum)})\\b"
        },
        {
            "name": "keyword",
            "match": f"(?i)\\b({'|'.join(keyword)})\\b"
        },
        {
            "name": "variable.other.enummember",
            "match": f"(?i)\\b({'|'.join(variable_other_enummember)})\\b"
        },
        {
            "name": "constant.numeric",
            "match": "\\b(\\d+)\\b"
        },
        {
            "name": "variable",
            "match": "\\b(\\w+)\\b"
        }
    ],
    "repository": {},
    "scopeName": "source.popfile"
}, indent=4))
