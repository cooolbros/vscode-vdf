const pattern = /\s/

export function quote(value: string): boolean {
	if (value.length == 0 || pattern.test(value)) {
		return true
	}

	const trimmed = value.trim()
	const start = trimmed.startsWith("{") || trimmed.startsWith("}") || trimmed.startsWith("\"") || trimmed.startsWith("[") || trimmed.startsWith("//")
	const end = trimmed.endsWith("{") || trimmed.endsWith("}") || trimmed.endsWith("\"")

	return start || end
}
