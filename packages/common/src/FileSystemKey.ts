import type { Uri } from "./Uri"

export type FileSystemKey = (
	| { type: "tf2" }
	| { type: "folder", uri: Uri }
	| { type: "popfile:bsp", uri: Uri }
	| { type: "bsp", uri: Uri }
)
