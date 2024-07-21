import { open } from "fs/promises"
import { join } from "path/posix"
import { Lazy } from "utils/Lazy"
import { VPK, VPKFileType } from "vpk"
import { Disposable, EventEmitter, FilePermission, FileSystemError, FileType, Uri, workspace, type Event, type FileChangeEvent, type FileStat, type FileSystemProvider } from "vscode"
import { z } from "zod"

export class VPKFileSystemProvider implements FileSystemProvider {

	private static readonly VPKTypeSchema = z.enum(["misc", "sound_misc", "textures"])

	private readonly vpks: { [P in z.infer<typeof VPKFileSystemProvider["VPKTypeSchema"]>]: Lazy<Promise<{ stat: FileStat, vpk: VPK }>> }
	public readonly onDidChangeFile: Event<FileChangeEvent[]>

	constructor(fileSystem: VSCodeVDFFileSystem) {

		let load: ((type: keyof VPKFileSystemProvider["vpks"]) => Promise<{ stat: FileStat, vpk: VPK }>) | null = async (type: keyof VPKFileSystemProvider["vpks"]) => {
			const uri = Uri.file(join(workspace.getConfiguration("vscode-vdf")["teamFortress2Folder"], `tf/tf2_${type}_dir.vpk`)).toString()
			const statPromise = fileSystem.stat(uri)
			const vpkPromise = new Promise(async () => new VPK(new DataView((await fileSystem.readFileBinary(uri)).buffer)))
			return Promise
				.all([statPromise, vpkPromise])
				.then(([stat, vpk]) => ({
					stat,
					vpk
				}))
		}

		this.vpks = {
			misc: new Lazy(() => load!("misc")),
			sound_misc: new Lazy(() => load!("sound_misc")),
			textures: new Lazy(() => load!("textures")),
		}

		this.onDidChangeFile = new EventEmitter<FileChangeEvent[]>().event
	}

	private async entry(uri: Uri) {
		const type = VPKFileSystemProvider.VPKTypeSchema.parse(new URLSearchParams(uri.query).get("vpk"))
		const path = uri.path.substring(1)
		return {
			archiveType: type,
			path: path,
			value: (await this.vpks[type].value).vpk.entry(path)
		}
	}

	watch(): Disposable {
		return Disposable.from()
	}

	async stat(uri: Uri): Promise<FileStat> {

		const { archiveType, value } = await this.entry(uri)

		const entry = value
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

		const stat = (await this.vpks[archiveType].value).stat

		return {
			type: type,
			ctime: stat.ctime,
			mtime: stat.mtime,
			size: size,
			permissions: FilePermission.Readonly
		} satisfies FileStat
	}

	async readDirectory(uri: Uri): Promise<[string, FileType][]> {

		const entry = (await this.entry(uri)).value
		if (!entry) {
			throw FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.File) {
			throw FileSystemError.FileNotADirectory()
		}

		return [...entry.value.entries()].map(([name, entry]) => <const>[name, entry.type == VPKFileType.File ? FileType.File : FileType.Directory])
	}

	createDirectory(uri: Uri): void {
		throw FileSystemError.Unavailable()
	}

	async readFile(uri: Uri): Promise<Uint8Array> {

		const { archiveType, value } = await this.entry(uri)

		const entry = value
		if (!entry) {
			throw FileSystemError.FileNotFound()
		}

		if (entry.type == VPKFileType.Directory) {
			throw FileSystemError.FileIsADirectory()
		}

		const file = await open(join(workspace.getConfiguration("vscode-vdf")["teamFortress2Folder"], `tf/tf2_${archiveType}_${entry.value.archiveIndex == 255 ? "_dir" : entry.value.archiveIndex.toString().padStart(3, "0")}.vpk`), "r")
		const buf = Buffer.alloc(entry.value.entryLength)
		await file.read(buf, 0, entry.value.entryLength, entry.value.entryOffset)
		file.close()

		return buf
	}

	writeFile(): void {
		throw FileSystemError.Unavailable()
	}

	delete(): void {
		throw FileSystemError.Unavailable()
	}

	rename(): void {
		throw FileSystemError.Unavailable()
	}

	copy?(): void {
		throw FileSystemError.Unavailable()
	}
}
