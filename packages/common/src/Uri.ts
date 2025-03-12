import { posix } from "path"
import { URI, Utils } from "vscode-uri"
import { z } from "zod"

export class Uri {

	public static readonly schema = z.object({
		scheme: z.string(),
		authority: z.string(),
		path: z.string(),
		query: z.string(),
		fragment: z.string(),
	}).transform((arg) => new Uri(arg))

	public static equals(a: Uri | null, b: Uri | null): boolean {
		if (a == b) {
			return true
		}

		if (a != null && b != null) {
			return a.equals(b)
		}

		return false
	}

	private readonly uri: URI

	public readonly scheme: string
	public readonly authority: string
	public readonly path: string
	public readonly query: string
	public readonly fragment: string
	public readonly fsPath: string

	public constructor(uri: string | { scheme: string, authority?: string, path?: string, query?: string, fragment?: string }) {
		this.uri = typeof uri == "string" ? URI.parse(uri) : URI.isUri(uri) ? uri : URI.from(uri)
		this.scheme = this.uri.scheme
		this.authority = this.uri.authority
		this.path = this.uri.path
		this.query = this.uri.query
		this.fragment = this.uri.fragment
		this.fsPath = this.uri.fsPath.split(/[/\\]/).join("/")
	}

	public dirname() {
		return new Uri(Utils.dirname(this))
	}

	public basename() {
		return posix.basename(this.path)
	}

	public joinPath(...paths: string[]) {
		return this.with({ path: posix.join(this.path, ...paths.map((path) => path.split(/[/\\]/)).flat()) })
	}

	public relative(to: Uri): string {
		return posix.relative(this.uri.path, to.path)
	}

	equals(other?: Uri | null): boolean {
		if (!other) {
			return false
		}

		return this.scheme == other.scheme
			&& this.authority == other.authority
			&& this.path == other.path
			&& this.query == other.query
			&& this.fragment == other.fragment
	}

	public with(changes: Parameters<URI["with"]>[0]) {
		return new Uri(this.uri.with(changes))
	}

	public toString(skipEncoding?: boolean): string {
		return this.uri.toString(skipEncoding)
	}

	public toJSON() {
		return {
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		}
	}
}
