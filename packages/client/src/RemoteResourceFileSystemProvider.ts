import vscode, { Disposable, EventEmitter, FileSystemError, FileType, type Event, type FileChangeEvent, type FileStat, type FileSystemProvider, } from "vscode"
import { z } from "zod"

export class RemoteResourceFileSystemProvider implements FileSystemProvider {

	public static readonly scheme = "vscode-vdf-tf-remote-resource"
	public static readonly base = "https://vscode.pfwobcke.dev"

	public readonly onDidChangeFile: Event<FileChangeEvent[]>

	constructor() {
		this.onDidChangeFile = new EventEmitter<FileChangeEvent[]>().event
	}

	public watch(): Disposable {
		return Disposable.from()
	}

	public async stat(uri: vscode.Uri): Promise<FileStat> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		url.searchParams.set("stat", "")
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return z.object({
					type: z.number().transform((arg) => (FileType.Unknown | arg) as FileType),
					ctime: z.number(),
					mtime: z.number(),
					size: z.number(),
					permissions: z.number().optional(),
				}).parse(await response.json()) as FileStat
			case 404:
				throw FileSystemError.FileNotFound()
			default:
				throw FileSystemError.Unavailable(uri)
		}
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, FileType][]> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		url.searchParams.set("readdir", "")
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return z
					.tuple([z.string(), z.number()])
					.array()
					.parse(await response.json())
			case 415:
				throw FileSystemError.FileNotADirectory()
			default:
				throw FileSystemError.Unavailable(uri)
		}
	}

	public createDirectory(): void {
		throw FileSystemError.NoPermissions()
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return await response.bytes()
			case 404:
				throw FileSystemError.FileNotFound()
			case 415:
				throw FileSystemError.FileIsADirectory()
			default:
				throw FileSystemError.Unavailable(uri)
		}
	}

	public writeFile(): void {
		throw FileSystemError.NoPermissions()
	}

	public delete(): void {
		throw FileSystemError.NoPermissions()
	}

	public rename(): void {
		throw FileSystemError.NoPermissions()
	}

	public copy?(): void {
		throw FileSystemError.NoPermissions()
	}
}
