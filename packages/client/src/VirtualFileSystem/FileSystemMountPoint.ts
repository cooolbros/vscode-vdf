import type { Uri } from "common/Uri"
import type { Observable } from "rxjs"
import type { FileType } from "vscode"

export interface FileSystemMountPoint {
	resolveFile(path: string): Observable<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, FileType][]>
	dispose(): void
}
