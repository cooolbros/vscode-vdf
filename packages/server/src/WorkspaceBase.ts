import type { Uri } from "common/Uri"
import { ReplaySubject } from "rxjs"

export abstract class WorkspaceBase implements AsyncDisposable {

	public readonly uri: Uri
	public readonly dispose$: ReplaySubject<void>

	constructor(uri: Uri) {
		this.uri = uri
		this.dispose$ = new ReplaySubject(1)
	}

	public relative(uri: Uri) {
		return this.uri.relative(uri)
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		this.dispose$.next()
	}
}
