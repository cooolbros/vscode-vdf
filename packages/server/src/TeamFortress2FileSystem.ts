import type { Uri } from "common/Uri"
import { defer, distinctUntilChanged, finalize, Observable, shareReplay, tap } from "rxjs"
import { } from "vscode-languageserver"

export interface FileSystemService {
	resolveFile(path: string): Observable<Uri | null>
	readDirectory(path: string, options: { recursive?: boolean, pattern?: string }): Promise<[string, number][]>
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
				// https://github.com/ReactiveX/rxjs/issues/4803#issuecomment-496711335
				(source) => defer(() => {
					let lastValue: Uri | null
					return source.pipe(
						tap((value) => lastValue = value),
						finalize(() => {
							if (lastValue == null) {
								this.files.delete(path)
							}
						})
					)
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
}
