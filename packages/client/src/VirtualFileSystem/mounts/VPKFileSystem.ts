import { Uri } from "common/Uri"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import { VSCodeFileSystem } from "../VSCodeFileSystem"

/**
 * @class
 */
export async function VPKFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	const authority = JSON.stringify(root)
	return VSCodeFileSystem(
		root,
		vscode.FileType.File,
		false,
		(path) => new Uri({ scheme: "vpk", authority: authority, path: `/${path}`, query: "", fragment: "" })
	)
}
