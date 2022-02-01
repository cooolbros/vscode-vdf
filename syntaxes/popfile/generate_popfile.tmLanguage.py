import os
import json

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
        *list(map(lambda f: { "name": os.path.splitext(f)[0], "match": "(?i)\\b(" + "|".join(map(lambda f: f.strip(), sorted(open(f, "r").readlines()))) + ")\\b" }, filter(lambda f: f.endswith(".txt"), os.listdir()))),
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
