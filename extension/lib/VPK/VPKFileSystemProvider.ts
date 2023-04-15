import { Disposable, Event, EventEmitter, FileChangeEvent, FileStat, FileSystemError, FileSystemProvider, FileType, Uri } from "vscode"
import { z } from "zod"
import type { VPK } from "./VPK"
import type { VPKManager } from "./VPKManager"

export class VPKFileSystemProvider implements FileSystemProvider {

	private readonly vpks: VPKManager
	public onDidChangeFile: Event<FileChangeEvent[]>
	private readonly VPKURLSearchParamsSchema = z.object({ vpk: z.enum(["misc", "sound_misc", "textures"]) })

	constructor(vpks: VPKManager) {
		this.vpks = vpks
		this.onDidChangeFile = new EventEmitter<FileChangeEvent[]>().event
	}

	private async getVPK(uri: Uri): Promise<VPK> {
		const VPKrelativePath = `tf/tf2_${this.VPKURLSearchParamsSchema.parse(Object.fromEntries(new URLSearchParams(uri.query))).vpk}_dir.vpk`
		return this.vpks.get(VPKrelativePath)
	}

	public watch(): Disposable {
		return Disposable.from()
	}

	public async stat(uri: Uri): Promise<FileStat> {
		return (await this.getVPK(uri)).stat(uri.path.substring(1))
	}

	public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		return (await this.getVPK(uri)).readDirectory(uri.path.substring(1))
	}

	public createDirectory(): void {
		throw FileSystemError.Unavailable()
	}

	public async readFile(uri: Uri): Promise<Uint8Array> {
		return (await this.getVPK(uri)).readFile(uri.path.substring(1))
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