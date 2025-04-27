import { open } from "fs/promises"
import { posix } from "path"
import { VPK, VPKFileType, type VPKEntry } from "vpk"
import vscode, { Disposable, EventEmitter, FilePermission, FileSystemError, FileType, workspace, type Event, type FileChangeEvent, type FileStat, type FileSystemProvider } from "vscode"

export class VPKFileSystemProvider implements FileSystemProvider {

	private readonly vpks: Map<string, Promise<{ stat: FileStat, vpk: VPK }>>

	public readonly onDidChangeFile: Event<FileChangeEvent[]>

	constructor() {
		this.vpks = new Map()
		this.onDidChangeFile = new EventEmitter<FileChangeEvent[]>().event
	}

	private async resolve(uri: vscode.Uri) {

		const vpkUri = vscode.Uri.from(JSON.parse(uri.authority))

		let vpk = this.vpks.get(vpkUri.toString())
		if (!vpk) {
			vpk = (async () => {
				const [stat, { buffer }] = await Promise.all([
					workspace.fs.stat(vpkUri),
					workspace.fs.readFile(vpkUri)
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

	public watch(): Disposable {
		return Disposable.from()
	}

	public async stat(uri: vscode.Uri): Promise<FileStat> {

		const entry = await this.entry(uri)
		if (!entry) {
			throw FileSystemError.FileNotFound()
		}

		let type: FileType
		let size: number

		switch (entry.type) {
			case VPKFileType.File:
				type = FileType.File
				size = entry.value.entryLength
				break
			case VPKFileType.Directory:
				type = FileType.Directory
				size = 0
				break
		}

		const { stat } = await this.resolve(uri)

		return {
			type: type,
			ctime: stat.ctime,
			mtime: stat.mtime,
			size: size,
			permissions: FilePermission.Readonly
		}
	}

	public async readDirectory(uri: vscode.Uri): Promise<[string, FileType][]> {

		const entry = await this.entry(uri)
		if (!entry) {
			throw FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.File) {
			throw FileSystemError.FileNotADirectory()
		}

		return entry
			.value
			.entries()
			.map(([name, entry]): [string, FileType] => [name, entry.type == VPKFileType.File ? FileType.File : FileType.Directory])
			.toArray()
	}

	public createDirectory(): void {
		throw FileSystemError.Unavailable()
	}

	public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

		const entry = await this.entry(uri)
		if (!entry) {
			throw FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.Directory) {
			throw FileSystemError.FileIsADirectory()
		}

		const vpkUri = vscode.Uri.from(JSON.parse(uri.authority))

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
		throw FileSystemError.Unavailable()
	}

	public delete(): void {
		throw FileSystemError.Unavailable()
	}

	public rename(): void {
		throw FileSystemError.Unavailable()
	}

	public copy?(): void {
		throw FileSystemError.Unavailable()
	}
}
