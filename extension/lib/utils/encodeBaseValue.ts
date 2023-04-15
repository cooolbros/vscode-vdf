export function encodeBaseValue(value: string): string {
	// Don't call encodeURIComponent on #base value because '/' will get encoded
	return value.split(/[/\\]+/).map(encodeURIComponent).join("/")
}
