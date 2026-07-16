import { AsyncDisposableBase } from "common/AsyncDisposableBase"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { Uri } from "common/Uri"

export abstract class WorkspaceBase extends AsyncDisposableBase {

	public readonly uri: Uri
	protected readonly fileSystem: FileSystemMountPoint

	constructor(uri: Uri, fileSystem: FileSystemMountPoint) {
		super()
		this.uri = uri
		this.fileSystem = this.stack.use(fileSystem)
	}

	public relative(uri: Uri) {
		return this.uri.relative(uri)
	}
}
