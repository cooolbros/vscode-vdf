import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import vscode from "vscode"
import { VSCodeFileSystem } from "./VSCodeFileSystem"

/**
 * @class
 */
export async function FolderFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	return await VSCodeFileSystem({
		root: root,
		type: vscode.FileType.Directory,
		watch: true,
		resolvePath: (path) => root.joinPath(path)
	})
}
