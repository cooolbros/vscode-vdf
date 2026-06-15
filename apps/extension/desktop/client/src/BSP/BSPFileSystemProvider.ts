import { type BSPEntry, type Files, type Pakfile } from "bsp"
import { Uri } from "common/Uri"
import vscode from "vscode"
import type { BSPFactory } from "../BSPFactory"

export class BSPFileSystemProvider implements vscode.FileSystemProvider {

	private readonly bsps: Map<string, Promise<{ stat: vscode.FileStat, bsp: { pakfile: Pakfile, files: Files } }>>

	public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

	constructor(private readonly bspFactory: BSPFactory) {
		this.bsps = new Map()
		this.onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>().event
	}

	private async resolve(uri: vscode.Uri) {

		const bspUri = vscode.Uri.from(JSON.parse(new URLSearchParams(uri.query).get("root")!))

		let bsp = this.bsps.get(bspUri.toString())
		if (!bsp) {
			bsp = (async () => {
				const [stat, bsp] = await Promise.all([
					vscode.workspace.fs.stat(bspUri),
					this.bspFactory.get(new Uri(bspUri))
				])

				const pakfile = bsp.pakfile()
				const files = pakfile.files()

				return {
					stat: stat,
					bsp: {
						pakfile: pakfile,
						files: files,
					}
				}
			})()

			this.bsps.set(bspUri.toString(), bsp)
		}

		return await bsp
	}

	private async entry(uri: vscode.Uri): Promise<{ bsp: { pakfile: Pakfile }, entry: BSPEntry | null }> {
		const { bsp } = await this.resolve(uri)
		const path = uri.path.substring(1)

		let tree: BSPEntry = { type: "Directory", value: bsp.files }
		if (path == "") {
			return {
				bsp,
				entry: tree
			}
		}

		for (const folder of path.toLowerCase().split("/")) {

			if (tree.type == "File") {
				return { bsp: bsp, entry: null }
			}

			const entry = tree.value.get(folder)
			if (entry == undefined) {
				return { bsp: bsp, entry: null }
			}

			tree = entry
		}

		return {
			bsp: bsp,
			entry: tree
		}
	}

	public watch(uri: vscode.Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
		return vscode.Disposable.from()
	}

	public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {

		const { bsp, entry } = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		let type: vscode.FileType
		let size: number

		switch (entry.type) {
			case "File":
				type = vscode.FileType.File
				size = entry.value.len
				break
			case "Directory":
				type = vscode.FileType.Directory
				size = 0
				break
		}

		const { stat } = await this.resolve(uri)

		return {
			type: type,
			ctime: stat.ctime,
			mtime: stat.mtime,
			size: size,
			permissions: vscode.FilePermission.Readonly
		}
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {

		const { bsp, entry } = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		if (entry.type == "File") {
			throw vscode.FileSystemError.FileNotADirectory()
		}

		return entry
			.value
			.entries()
			.map(([name, entry]): [string, vscode.FileType] => [name, entry.type == "File" ? vscode.FileType.File : vscode.FileType.Directory])
			.toArray()
	}

	public createDirectory(uri: vscode.Uri): void {
		throw vscode.FileSystemError.Unavailable()
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

		const { bsp, entry } = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		if (entry.type == "Directory") {
			throw vscode.FileSystemError.FileIsADirectory()
		}

		return bsp.pakfile.read(entry.value.index)
	}

	public writeFile(uri: vscode.Uri, content: Uint8Array, options: { readonly create: boolean; readonly overwrite: boolean }): void | Thenable<void> {
		throw vscode.FileSystemError.Unavailable()
	}

	public delete(uri: vscode.Uri, options: { readonly recursive: boolean }): void | Thenable<void> {
		throw vscode.FileSystemError.Unavailable()
	}

	public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
		throw vscode.FileSystemError.Unavailable()
	}

	public copy?(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
		throw vscode.FileSystemError.Unavailable()
	}
}
