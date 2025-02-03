import type { Uri } from "common/Uri"

export abstract class WorkspaceBase {

	public readonly uri: Uri

	constructor(uri: Uri) {
		this.uri = uri
	}

	public relative(uri: Uri) {
		return this.uri.relative(uri)
	}
}
