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

		let i = 0

		const signature = data.getUint32(i, true)
		if (signature != 1437209140) {
			throw new Error(`Invalid VPK Signature: Expected ${1437209140}, got ${signature}`)
		}
		i += 4

		const version = data.getUint32(i, true)
		i += 4

		const treeSize = data.getUint32(i, true)
		i += 4

		if (version == 2) {
			const fileDataSectionSize = data.getUint32(i, true)
			i += 4

			const archiveMD5SectionSize = data.getUint32(i, true)
			i += 4

			const otherMD5SectionSize = data.getUint32(i, true)
			i += 4

			const signatureSectionSize = data.getUint32(i, true)
			i += 4
		}

		const headerSize = i

		const readString = (): string => {
			const start = i
			while (data.getUint8(i) != 0) {
				i++
			}
			const end = i
			i++

			// @ts-ignore
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

					// const crc = data.getUint32(i, true)
					i += 4

					// const preloadBytes = data.getUint16(i, true)
					i += 2

					const archiveIndex = data.getUint16(i, true)
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
						{ type: VPKFileType.File, value: { archiveIndex, entryOffset: archiveIndex == 32767 ? headerSize + treeSize + entryOffset : entryOffset, entryLength } }
					)
				}
			}
		}
	}

	public entry(path: string): VPKEntry | null {

		let tree: VPKEntry = this.tree
		if (path == "") {
			return tree
		}

		for (const folder of path.toLowerCase().split("/")) {

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
