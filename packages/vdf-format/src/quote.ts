const pattern = /\s/

export function quote(value: string): boolean {
	if (value.length == 0 || pattern.test(value)) {
		return true
	}

	const trimmed = value.trim()
	const includes = trimmed.includes("{") || trimmed.includes("}")
	const start = trimmed.startsWith("\"") || trimmed.startsWith("[") || trimmed.startsWith("//")
	const end = trimmed.endsWith("\"")

	return includes || start || end
}
