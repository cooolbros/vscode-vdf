import type { VDFPosition } from "vdf"

export interface CompletionToken {
	quoted: boolean
	value: string
	start: number
	end: number
	current: boolean
}

// Error tolerant VDF line tokeniser
export function generateTokens(line: string, position: VDFPosition): CompletionToken[] | null {

	if (line.substring(position.character).includes("//")) {
		return null
	}

	// Parse entire line to include potential closing double quote after position.character
	const tokens = Array.from((function*() {
		let i = 0

		while (i < line.length) {
			while (line[i] == " " || line[i] == "\t") {
				i++
			}

			if (i >= line.length) {
				return
			}

			if (line[i] == "\"") {
				const rangeStart = i
				i++
				const valueStart = i
				while (i < line.length && line[i] != "\"") {
					i++
				}
				const valueEnd = i
				i++
				const rangeEnd = i
				yield { quoted: true, value: line.slice(valueStart, valueEnd), start: rangeStart, end: rangeEnd, current: false }
			}
			else {
				const start = i
				while (i < line.length && line[i] != " " && line[i] != "\t" && line[i] != "\"") {
					i++
				}
				const end = i
				yield { quoted: false, value: line.slice(start, end), start: start, end: end, current: false }
			}
		}
	})())

	// Remove tokens before and including opening brace,
	// so we suggest for the innermost key
	// https://github.com/cooolbros/vscode-vdf/issues/48
	tokens.splice(0, tokens.findLastIndex((token) => !token.quoted && token.value == "{") + 1)

	// Remove tokens after position.character
	const currentTokenIndex = tokens.findIndex((token) => token.start <= position.character && token.end >= position.character)
	if (currentTokenIndex != -1) {
		// If we are inside a token, remove all tokens after current
		tokens.splice(currentTokenIndex + 1)
	}
	else {
		// If we are outside a token, remove all tokens that start after position.character
		const nextTokenIndex = tokens.findIndex((token) => token.start > position.character)

		// Only if we are not the last token
		if (nextTokenIndex != -1) {
			tokens.splice(nextTokenIndex + 1)
		}
	}

	const includes = (token: CompletionToken) => {
		return token.quoted
			? position.character < token.end
			: position.character <= token.end
	}

	for (const token of tokens) {
		if (includes(token)) {
			token.current = true
		}
		break
	}

	return tokens
}
