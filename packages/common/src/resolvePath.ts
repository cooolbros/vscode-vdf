import { posix } from "path"

export function resolvePath(value: string, extension?: `.${string}`): string {
	value = value.replaceAll(/[/\\]+/g, "/")
	if (extension != undefined && posix.extname(value) != extension) {
		value += extension
	}
	return posix.resolve(`/${value}`).substring(1)
}
