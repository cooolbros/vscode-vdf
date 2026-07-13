import type { Uri } from "./Uri"

export type FileSystemKey = (
	| { type: "tf2", teamFortress2Folder: Uri }
	| { type: "folder", folder: Uri }
	| { type: "popfile:bsp", teamFortress2Folder: Uri, popfile: Uri }
	| { type: "bsp", bsp: Uri }
)
