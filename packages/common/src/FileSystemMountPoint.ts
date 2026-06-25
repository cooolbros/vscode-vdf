import type { Observable } from "rxjs"
import type { FileType } from "vscode"
import type { Uri } from "./Uri"

export interface FileSystemMountPoint extends AsyncDisposable {
	resolve(path: string): Observable<Entry>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, FileType][]>
	watchDirectory(path: string, options: { pattern?: string }): Observable<[string, FileType][]>
}

export const enum EntryType {
	None,
	File,
	Directory,
}

export type Entry = (
	| { type: EntryType.None, uri: null }
	| { type: EntryType.File, uri: Uri }
	| { type: EntryType.Directory, uri: Uri }
)
