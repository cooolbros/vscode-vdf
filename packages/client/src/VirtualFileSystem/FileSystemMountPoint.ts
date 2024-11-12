import type { Uri } from "common/Uri"

export interface FileSystemMountPoint {
	resolveFile(path: string): Promise<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]>
	dispose(): void
}
