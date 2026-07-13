const soundChars = new Set([
	"*" /* CHAR_STREAM */,
	"?" /* CHAR_USERVOX */,
	"!" /* CHAR_SENTENCE */,
	"#" /* CHAR_DRYMIX */,
	">" /* CHAR_DOPPLER */,
	"<" /* CHAR_DIRECTIONAL */,
	"^" /* CHAR_DISTVARIANT */,
	"@" /* CHAR_OMNI */,
	")" /* CHAR_SPATIALSTEREO */,
	"}" /* CHAR_FAST_PITCH */,
])

export const removeSoundChars = (value: string): { chars: string, value: string } => {
	let i = 0
	while (i < value.length) {
		if (!soundChars.has(value[i])) {
			break
		}
		i += 1
	}

	const chars = value.slice(0, i)
	value = value.slice(i)
	return { chars, value }
}
