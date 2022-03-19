import VTFImageFormats from "./VTFImageFormats.json"

const VTF_VERSION_MAJOR_OFFSET = 4
const VTF_VERSION_MINOR_OFFSET = 8
const VTF_WIDTH_OFFSET = 16
const VTF_HEIGHT_OFFSET = 18
const VTF_FLAGS_OFFSET = 20
const VTF_IMAGE_FORMAT_OFFSET = 52

export interface VTFBackup {
	flags: number
	changes: number
}

/**
 * https://developer.valvesoftware.com/wiki/Valve_Texture_Format
 */
export class VTF {

	private readonly buf: Buffer
	private readonly versionMajor: number
	private readonly versionMinor: number
	public get version(): string { return `${this.versionMajor}.${this.versionMinor}` }
	readonly width: number
	readonly height: number
	readonly flags: {
		"point-sample": boolean
		"trilinear-sample": boolean
		"clamp-s": boolean
		"clamp-t": boolean
		"anisotropic-sampling": boolean
		"hint-DXT5": boolean
		"SRGB": boolean
		"normal-map": boolean
		"no-mipmap": boolean
		"no-level-of-detail": boolean
		"no-minimum-mipmap": boolean
		"procedural": boolean
		"one-bit-alpha": boolean
		"eight-bit-alpha": boolean
		"environment-map": boolean
		"render-target": boolean
		"depth-render-target": boolean
		"no-debug-override": boolean
		"single-copy": boolean
		"pre-SRGB": null
		// "one-over-mipmap-level-in-alpha": null
		"premultiply-color-by-one-over-mipmap-level": null
		"normal-to-DuDv": null
		"alpha-test-mipmap-generation": null
		"no-depth-buffer": boolean
		"nice-filtered": null
		"clamp-u": boolean
		"vertex-texture": boolean
		"SSBump": boolean
		"border": null
		"clamp-all": boolean	// This isn't documented on the Valve Developer Wiki website but exists in VTFEdit
	}
	public readonly imageFormat: string

	public savedFlags: number

	/**
	 *
	 * @param buf VTF file buffer
	 * @param backup VTF file backup flags number to restore flags from
	 */
	constructor(buf: Buffer, backup?: VTFBackup) {
		this.buf = buf
		this.versionMajor = this.buf.readUInt16LE(VTF_VERSION_MAJOR_OFFSET)
		this.versionMinor = this.buf.readUInt16LE(VTF_VERSION_MINOR_OFFSET)
		this.width = this.buf.readUInt16LE(VTF_WIDTH_OFFSET)
		this.height = this.buf.readUInt16LE(VTF_HEIGHT_OFFSET)
		this.flags = {
			"point-sample": false,
			"trilinear-sample": false,
			"clamp-s": false,
			"clamp-t": false,
			"anisotropic-sampling": false,
			"hint-DXT5": false,
			"SRGB": false,
			"normal-map": false,
			"no-mipmap": false,
			"no-level-of-detail": false,
			"no-minimum-mipmap": false,
			"procedural": false,
			"one-bit-alpha": false,
			"eight-bit-alpha": false,
			"environment-map": false,
			"render-target": false,
			"depth-render-target": false,
			"no-debug-override": false,
			"single-copy": false,
			"pre-SRGB": null,
			"premultiply-color-by-one-over-mipmap-level": null,
			"normal-to-DuDv": null,
			"alpha-test-mipmap-generation": null,
			"no-depth-buffer": false,
			"nice-filtered": null,
			"clamp-u": false,
			"vertex-texture": false,
			"SSBump": false,
			"border": null,
			"clamp-all": false
		}

		this.savedFlags = this.buf.readUInt32LE(VTF_FLAGS_OFFSET)

		const flags = backup != undefined ? backup.flags : this.savedFlags
		this.setFlags(flags)

		this.imageFormat = VTFImageFormats[this.buf.readUInt32LE(VTF_IMAGE_FORMAT_OFFSET)]
	}

	public getFlags(): number {
		return parseInt(Object.values(this.flags).reverse().map(Number).join(""), 2)
	}

	public setFlags(flags: number): void {
		const documentFlagsBinary = flags.toString(2)
		const documentFlags = `${"0".repeat(32 - documentFlagsBinary.length)}${documentFlagsBinary}`
		let i = documentFlags.length - 1
		let flagID: keyof VTF["flags"]
		for (flagID in this.flags) {
			if (this.flags[flagID] != null) {
				// @ts-ignore
				this.flags[flagID] = documentFlags[i] == "1"
			}
			i--
		}
	}

	public save(): Buffer {
		this.savedFlags = this.getFlags()
		this.buf.writeUInt32LE(this.savedFlags, VTF_FLAGS_OFFSET)
		return this.buf
	}

	public saveAs(): Buffer {
		const flags = this.getFlags()
		const buf = Buffer.from(this.buf)
		buf.writeUInt32LE(flags, VTF_FLAGS_OFFSET)
		return buf
	}
}
