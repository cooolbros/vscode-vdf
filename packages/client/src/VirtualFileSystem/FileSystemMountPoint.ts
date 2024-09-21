import type { Uri } from "common/Uri"

export interface FileSystemMountPoint {
	resolveFile(path: string, update: ((uri: Uri | null) => void) | null): Promise<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]>
	remove(path: string): void
	dispose(): void
}
