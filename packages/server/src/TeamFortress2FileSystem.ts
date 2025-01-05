import { finalizeWithValue } from "common/operators/finalizeWithValue"
import type { Uri } from "common/Uri"
import { distinctUntilChanged, Observable, shareReplay } from "rxjs"

export interface FileSystemService {
	resolveFile(path: string): Observable<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]>
	dispose(): any
}

export class TeamFortress2FileSystem {

	public readonly paths: Uri[]
	private readonly fileSystemService: FileSystemService
	private readonly files: Map<string, Observable<Uri | null>>

	constructor(paths: Uri[], fileSystemService: FileSystemService) {
		this.paths = paths
		this.fileSystemService = fileSystemService
		this.files = new Map()
	}

	public resolveFile(path: string): Observable<Uri | null> {
		let file$ = this.files.get(path)
		if (!file$) {
			file$ = this.fileSystemService.resolveFile(path).pipe(
				distinctUntilChanged(),
				finalizeWithValue((value) => {
					if (value == null) {
						this.files.delete(path)
					}
				}),
				shareReplay({
					bufferSize: 1,
					refCount: true
				}),
			)
			this.files.set(path, file$)
		}
		return file$
	}

	public async readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]> {
		return await this.fileSystemService.readDirectory(path, options)
	}

	public dispose() {
		this.fileSystemService.dispose()
	}
}
