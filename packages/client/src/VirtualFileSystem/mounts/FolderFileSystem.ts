import { Uri } from "common/Uri"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import { VSCodeFileSystem } from "../VSCodeFileSystem"

/**
 * @class
 */
export async function FolderFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	return await VSCodeFileSystem(
		root,
		vscode.FileType.Directory,
		true,
		(path) => root.joinPath(path)
	)
}
