import type { Uri } from "./Uri"

export type FileSystemKey = (
	| { type: "tf2" }
	| { type: "folder", folder: Uri }
	| { type: "popfile:bsp", popfile: Uri }
	| { type: "bsp", bsp: Uri }
)
