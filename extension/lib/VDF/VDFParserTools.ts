import { Range } from "vscode-languageserver"

export const parserTools = {
	is: {
		comment: (str: string): str is `//${string}` => {
			return str.startsWith("//")
		},
		osTag: (str: string): str is `[${string}]` => {
			return str.startsWith("[") && str.endsWith("]")
		}
	},
	convert: {
		token: (str: string): [string, 0 | 1] => {
			const quoted = str.startsWith("\"") && str.endsWith("\"")
			return quoted ? [str.slice(1, -1), 1] : [str, 0]
		},
		osTag: (str: string): `[${string}]` => {
			return `[${str.slice(1, -1)}]`
		},
		comment: (str: `//${string}`): string => {
			// Extract comment text from comment string, the stringifyer will add the same
			// whitespace before every comment to unify, this removes indentation in comments
			return str.substring(2).trim()
		}
	},
	calculate: {
		tokenRange: ([str, quoted]: [string, 0 | 1], line: number, character: number): Range => {
			return Range.create(line, character - str.length - quoted, line, character - quoted)
		}
	}
}
