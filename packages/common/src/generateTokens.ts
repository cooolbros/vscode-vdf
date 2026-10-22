export interface CompletionToken {
	quoted: boolean
	value: string
	start: number
	end: number
}

// Error tolerant VDF line tokeniser
export function* generateTokens(line: string): Generator<CompletionToken> {
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
			yield { quoted: true, value: line.slice(valueStart, valueEnd), start: rangeStart, end: rangeEnd, }
		}
		else {
			const start = i
			while (i < line.length && line[i] != " " && line[i] != "\t" && line[i] != "\"") {
				i++
			}
			const end = i
			yield { quoted: false, value: line.slice(start, end), start: start, end: end }
		}
	}
}
