// Error tolerant VDF line tokeniser
export function* generateTokens(line: string) {
	let i = 0

	while (i < line.length) {
		while (line[i] == " " || line[i] == "\t") {
			i++
		}

		if (i >= line.length) {
			return
		}

		if (line[i] == "\"") {
			i++
			const start = i
			while (i < line.length && line[i] != "\"") {
				i++
			}
			const end = i
			i++
			yield line.slice(start, end)
		}
		else {
			const start = i
			while (i < line.length && line[i] != " " && line[i] != "\t" && line[i] != "\"") {
				i++
			}
			const end = i
			yield line.slice(start, end)
		}
	}
}
