export const enum VPKFileType {
	File = 1,
	Directory = 2
}

export type VPKEntry = VPKFileEntry | VPKDirectoryEntry

export type VPKFileEntry = { type: VPKFileType.File, value: VPKFile }
export type VPKFile = { archiveIndex: number, entryOffset: number, entryLength: number }

export type VPKDirectoryEntry = { type: VPKFileType.Directory, value: VPKDirectory }
export type VPKDirectory = Map<string, VPKEntry>

/**
 * https://developer.valvesoftware.com/wiki/VPK_File_Format
 */
export class VPK {

	private readonly decoder = new TextDecoder()
	private readonly tree: VPKDirectoryEntry = { type: VPKFileType.Directory, value: new Map() }

	constructor(data: DataView) {

		let i = 28

		const readString = (): string => {
			const start = i
			while (data.getUint8(i) != 0) {
				i++
			}
			const end = i
			i++

			return this.decoder.decode(data.buffer.slice(start, end))
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

				let tree: VPKDirectoryEntry = this.tree

				if (folderPath != " ") {

					for (const folder of folderPath.split("/")) {

						let entry = tree.value.get(folder)

						if (entry == undefined) {
							entry = { type: VPKFileType.Directory, value: new Map<string, VPKEntry>() }
							tree.value.set(folder, entry)
						}
						else if (entry.type == VPKFileType.File) {
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

					const archiveIndex = data.getUint8(i)
					i += 2

					const entryOffset = data.getUint32(i, true)
					i += 4

					const entryLength = data.getUint32(i, true)
					i += 4

					// Terminator
					const terminator = data.getUint16(i, true)
					if (terminator != 65535) {
						throw new Error(`Unexpected terminator! Expected 65535, got ${terminator}`)
					}
					i += 2

					tree.value.set(
						`${fileName}.${extension}`,
						{ type: VPKFileType.File, value: { archiveIndex, entryOffset, entryLength } }
					)
				}
			}
		}
	}

	public entry(path: string): VPKEntry | null {

		let tree: VPKEntry = this.tree

		for (const folder of path.split("/")) {

			if (tree.type == VPKFileType.File) {
				return null
			}

			const entry = tree.value.get(folder)
			if (entry == undefined) {
				return null
			}

			tree = entry
		}

		return tree
	}
}
