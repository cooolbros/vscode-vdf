import vscode from "vscode"
import { z } from "zod"

export class RemoteResourceFileSystemProvider implements vscode.FileSystemProvider {

	public static readonly scheme = "vscode-vdf-tf-remote-resource"
	public static readonly base = "https://vscode.pfwobcke.dev"

	public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

	constructor() {
		this.onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>().event
	}

	public watch(): vscode.Disposable {
		return vscode.Disposable.from()
	}

	public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		url.searchParams.set("stat", "")
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return z.object({
					type: z.number(),
					ctime: z.number(),
					mtime: z.number(),
					size: z.number(),
					permissions: z.number().optional(),
				}).parse(await response.json()) as vscode.FileStat
			case 404:
				throw vscode.FileSystemError.FileNotFound()
			default:
				throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		url.searchParams.set("readdir", "")
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return z.array(z.tuple([z.string(), z.number()])).parse(await response.json())
			case 415:
				throw vscode.FileSystemError.FileNotADirectory()
			default:
				throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	public createDirectory(): void {
		throw vscode.FileSystemError.NoPermissions()
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

		const url = new URL(uri.path, RemoteResourceFileSystemProvider.base)
		const response = await fetch(url)

		switch (response.status) {
			case 200:
				return await response.bytes()
			case 404:
				throw vscode.FileSystemError.FileNotFound()
			case 415:
				throw vscode.FileSystemError.FileIsADirectory()
			default:
				throw vscode.FileSystemError.Unavailable(uri)
		}
	}

	public writeFile(): void {
		throw vscode.FileSystemError.NoPermissions()
	}

	public delete(): void {
		throw vscode.FileSystemError.NoPermissions()
	}

	public rename(): void {
		throw vscode.FileSystemError.NoPermissions()
	}

	public copy?(): void {
		throw vscode.FileSystemError.NoPermissions()
	}
}
