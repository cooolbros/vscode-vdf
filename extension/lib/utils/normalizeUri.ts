export function normalizeUri(uri: string): string {
	return new URL(uri).href
}
