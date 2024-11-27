import type { Uri } from "common/Uri"
import type { Observable } from "rxjs"

export interface FileSystemMountPoint {
	resolveFile(path: string): Observable<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]>
	dispose(): void
}
