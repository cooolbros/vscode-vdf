import type { Observable } from "rxjs"
import type { FileType } from "vscode"
import type { Uri } from "./Uri"

export interface FileSystemMountPoint extends AsyncDisposable {
	resolveFile(path: string): Observable<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, FileType][]>
}
