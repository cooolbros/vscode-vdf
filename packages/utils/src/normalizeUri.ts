export function normalizeUri(uri: string): string {
	try {
		return new URL(uri).href
	}
	catch (error) {
		return uri
	}
}
