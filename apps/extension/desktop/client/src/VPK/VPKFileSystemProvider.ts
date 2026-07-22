import { open } from "fs/promises"
import { posix } from "path"
import { VPK, VPKFileType, type VPKEntry } from "vpk"
import vscode from "vscode"

export class VPKFileSystemProvider implements vscode.FileSystemProvider {

	private readonly vpks: Map<string, Promise<{ stat: vscode.FileStat, vpk: VPK }>>

	public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>

	constructor() {
		this.vpks = new Map()
		this.onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>().event
	}

	private async resolve(uri: vscode.Uri) {

		const vpkUri = vscode.Uri.from(JSON.parse(new URLSearchParams(uri.query).get("root")!))

		let vpk = this.vpks.get(vpkUri.toString())
		if (!vpk) {
			vpk = (async () => {
				const [stat, { buffer }] = await Promise.all([
					vscode.workspace.fs.stat(vpkUri),
					vscode.workspace.fs.readFile(vpkUri)
				])

				return {
					stat: stat,
					vpk: new VPK(new DataView(buffer))
				}
			})()

			this.vpks.set(vpkUri.toString(), vpk)
		}

		return await vpk
	}

	private async entry(uri: vscode.Uri): Promise<VPKEntry | null> {
		const { vpk } = await this.resolve(uri)
		const path = uri.path.substring(1)

		return vpk.entry(path)
	}

	public watch(): vscode.Disposable {
		return vscode.Disposable.from()
	}

	public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {

		const entry = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		let type: vscode.FileType
		let size: number

		switch (entry.type) {
			case VPKFileType.File:
				type = vscode.FileType.File
				size = entry.value.entryLength
				break
			case VPKFileType.Directory:
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

		const entry = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.File) {
			throw vscode.FileSystemError.FileNotADirectory()
		}

		return entry
			.value
			.entries()
			.map(([name, entry]): [string, vscode.FileType] => [name, entry.type == VPKFileType.File ? vscode.FileType.File : vscode.FileType.Directory])
			.toArray()
	}

	public createDirectory(): void {
		throw vscode.FileSystemError.Unavailable()
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

		const entry = await this.entry(uri)
		if (!entry) {
			throw vscode.FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.Directory) {
			throw vscode.FileSystemError.FileIsADirectory()
		}

		const vpkUri = vscode.Uri.from(JSON.parse(new URLSearchParams(uri.query).get("root")!))

		const archiveUri = vpkUri.with({
			path: posix.join(posix.dirname(vpkUri.path), posix.basename(vpkUri.path).replace("_dir.vpk", `_${entry.value.archiveIndex == 255 ? "_dir" : entry.value.archiveIndex.toString().padStart(3, "0")}.vpk`))
		})

		const file = await open(archiveUri.fsPath, "r")
		const buf = Buffer.alloc(entry.value.entryLength)

		await file.read(buf, 0, entry.value.entryLength, entry.value.entryOffset)
		file.close()

		return buf
	}

	public writeFile(): void {
		throw vscode.FileSystemError.Unavailable()
	}

	public delete(): void {
		throw vscode.FileSystemError.Unavailable()
	}

	public rename(): void {
		throw vscode.FileSystemError.Unavailable()
	}

	public copy?(): void {
		throw vscode.FileSystemError.Unavailable()
	}
}
