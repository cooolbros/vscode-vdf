import { open } from "fs/promises"
import { basename, dirname } from "path"
import { FilePermission, FileSystemError, FileType, Uri, type FileStat } from "vscode"

type VPKTree = Map<string, VPKEntry>
type VPKEntry = VPKTree | VPKFile
type VPKFile = { archiveIndex: number, entryOffset: number, entryLength: number }

/**
 * https://developer.valvesoftware.com/wiki/VPK_File_Format
 */
export class VPK {

	private readonly archivePath: string
	private readonly archiveStat: FileStat
	private readonly tree: VPKTree

	constructor(uri: string, stat: FileStat, buf: Uint8Array) {

		this.archivePath = `${dirname(Uri.parse(uri).fsPath)}/${basename(uri).replace("_dir.vpk", "")}`
		this.archiveStat = stat
		this.tree = new Map()

		const buffer = Buffer.from(buf)
		let i = 28

		function readString(): string {
			const start = i
			while (buffer[i] != 0) {
				i++
			}
			const end = i
			i++
			return buffer.subarray(start, end).toString()
		}

		while (true) {
			const extension = readString()

			if (extension == "") {
				break
			}

			while (true) {
				const folderPath = readString()

				if (folderPath == "") {
					break
				}

				let tree: VPKTree = this.tree

				if (folderPath != " ") {

					for (const folder of folderPath.split("/")) {

						let entry = tree.get(folder)

						if (entry == undefined) {
							entry = new Map<string, VPKEntry>()
							tree.set(folder, entry)
						}
						else if (!(entry instanceof Map)) {
							throw new Error(`Error parsing VPK: Found file entry while creating directory "${folderPath}"`)
						}

						tree = entry
					}
				}

				while (true) {
					const fileName = readString()

					if (fileName == "") {
						break
					}

					// const crc = buffer.readUInt32LE(i).toString(16)
					i += 4

					// Skip unsigned short PreloadBytes
					i += 2

					const archiveIndex = buffer.readUInt8(i)
					i += 2

					const entryOffset = buffer.readUint32LE(i)
					i += 4

					const entryLength = buffer.readUint32LE(i)
					i += 4

					// Terminator
					const terminator = buffer.readUint16LE(i)
					if (terminator != 65535) {
						throw new Error(`Unexpected terminator! Expected 65535, got ${terminator}`)
					}
					i += 2

					tree.set(`${fileName}.${extension}`, { archiveIndex, entryOffset, entryLength })
				}
			}
		}
	}

	private findEntry(filePath: string): VPKEntry {

		const folders = filePath.split(/[/\\]+/).filter((folder) => folder != "") // Remove trailing '/' from path

		let parent = "root"

		let tree: VPKEntry = this.tree

		for (const folder of folders) {

			if (!(tree instanceof Map)) {
				throw FileSystemError.FileNotFound()
			}

			const entry = tree.get(folder)

			if (entry == undefined) {
				throw FileSystemError.FileNotFound(`${parent} does not contain entry "${folder}"`)
			}

			tree = entry
			parent = folder
		}

		return tree
	}

	public stat(filePath: string): FileStat {
		const entry = this.findEntry(filePath)
		return {
			type: entry instanceof Map ? FileType.Directory : FileType.File,
			ctime: this.archiveStat.ctime,
			mtime: this.archiveStat.mtime,
			size: entry instanceof Map ? 0 : entry.entryLength,
			permissions: FilePermission.Readonly
		} satisfies FileStat
	}

	public readDirectory(folderPath: string): [string, FileType][] {

		const entry = this.findEntry(folderPath)

		if (!(entry instanceof Map)) {
			throw FileSystemError.FileNotADirectory()
		}

		return [...entry.entries()].map(([name, item]: [string, VPKEntry]): [string, FileType] => {
			return [name, item instanceof Map ? FileType.Directory : FileType.File]
		})
	}

	public async readFile(filePath: string): Promise<Buffer> {

		const entry = this.findEntry(filePath)

		if (entry instanceof Map) {
			throw FileSystemError.FileIsADirectory()
		}

		const vpkFilePath: `${string}.vpk` = `${this.archivePath}_${entry.archiveIndex == 255 ? "_dir" : entry.archiveIndex.toString().padStart(3, "0")}.vpk`

		const file = await open(vpkFilePath, "r")

		const buf = Buffer.alloc(entry.entryLength)

		await file.read(buf, 0, entry.entryLength, entry.entryOffset)

		file.close()

		return buf
	}
}
