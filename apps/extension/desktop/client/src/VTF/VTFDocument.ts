import { exec } from "child_process"
import { existsSync, rmSync, watch, type FSWatcher } from "fs"
import { mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { basename, join } from "path"
import { promisify } from "util"
import { EventEmitter, StatusBarAlignment, Uri, window, workspace, type CustomDocument, type StatusBarItem } from "vscode"
import { VTF, type VTFBackup } from "./VTF"

export interface VTFPropertyChangeEvent {
	scale?: number
	flags?: Partial<VTFDocument["flags"]>
}

export class VTFDocument implements CustomDocument {

	/**
	 * VTF Document Uri
	 */
	public readonly uri: Uri

	/**
	 * VTF File Watcher
	 * Runs {@link updateVTF}
	 */
	private readonly watcher?: FSWatcher

	/**
	 * VTF Property Change\
	 * Invokes a {@link VTFPropertyChangeEvent} when a VTF property is changed by the webview or external file change
	 */
	public readonly onVTFDidChangeEventEmitter: EventEmitter<VTFPropertyChangeEvent>

	/**
	 * Notify webview of state changes
	 * Invokes a {@link VTFPropertyChangeEvent} when the state should be sent to the webview
	 */
	public readonly onShouldSendStateEventEmitter: EventEmitter<VTFPropertyChangeEvent>

	/**
	 * VTF Document readonly
	 */
	public get isReadOnly(): boolean { return this.uri.scheme == "git" }

	/**
	 * Track changes made in the VTF Document, increments on change, decrements on undo, increments in redo
	 * 0 = VTF Document has no unsaved changes
	 * */
	public changes: number

	/**
	 * Whether the VTF Document has unsaved changes
	 * See {@link changes}
	 */
	public get isDirty(): boolean { return !this.isReadOnly && this.changes > 0 }

	/**
	 * VTF
	 */
	private VTF: VTF

	/**
	 * VTF Document Flags
	 */
	public flags: VTF["flags"]

	/**
	 * VTF Document Flags Proxy Handler
	 */
	private readonly handler: ProxyHandler<VTF["flags"]>

	/**
	 * VTF Version
	 */
	public get version(): string { return this.VTF.version }

	/**
	 * VTF Image Format
	 * [VTF Image Formats](VTFImageFormats.json).
	 */
	public get imageFormat(): string { return this.VTF.imageFormat }

	/**
	 * VTF Width
	 */
	public get width(): number { return this.VTF.width }

	/**
	 * VTF Height
	 */
	public get height(): number { return this.VTF.height }

	/**
	 * Absolute path to VTF TGA file
	 */
	public tgaPath: string

	private _scale: number
	/**
	 * VTF Zoom Scale (Between 0.1 and 2)
	 */
	public get scale(): number { return this._scale }
	public set scale(value: number) {
		this._scale = value
		const propertyChangedInfo = { scale: this.scale }
		this.onPropertyChanged(propertyChangedInfo)
		this.setState(propertyChangedInfo)
	}

	// Status Bar Item
	public readonly statusBarItem: StatusBarItem

	/**
	 * Asynchronously create a VTF Document from a workspace Uint8Array and VTF absolute file path
	 * @param extensionPath Extension path
	 * @param uri VTF File Uri
	 * @param backup VTF Document backup
	 * @returns The completed VTF Document
	 */
	public static async create(extensionPath: string, uri: Uri, backup?: VTFBackup): Promise<VTFDocument> {

		const vtfPath = uri.scheme == "file" ? uri.fsPath : join(tmpdir(), basename(uri.fsPath))

		const buf = Buffer.from(await workspace.fs.readFile(uri))

		if (uri.scheme == "vpk") {
			// File does not exist on disk
			await writeFile(vtfPath, buf)
		}

		const teamFortress2Folder: string = workspace.getConfiguration("vscode-vdf", uri).get("teamFortress2Folder")!

		const tgaFolder = join(extensionPath, ".TGA")
		if (!existsSync(tgaFolder)) {
			await mkdir(tgaFolder)
		}

		const tgaPath = join(tgaFolder, basename(uri.fsPath).split(".vtf").join(".tga"))

		const extract = VTFDocument.extractVTF(teamFortress2Folder, vtfPath, tgaPath)
		const document = new VTFDocument(uri, buf, tgaPath, backup)
		await extract

		return document
	}

	/**
	 *
	 * @param uri VTF File Uri
	 * @param buf Buffer
	 * @param tgaPath TGA Path
	 * @param backup VTF Document Backup
	 */
	private constructor(uri: Uri, buf: Buffer, tgaPath: string, backup?: VTFBackup) {

		this.uri = uri
		this.onVTFDidChangeEventEmitter = new EventEmitter<VTFPropertyChangeEvent>()
		this.changes = backup?.changes ?? 0

		// VTF
		this.VTF = new VTF(buf, backup)
		if (this.uri.scheme == "file") {
			this.watcher = watch(this.uri.fsPath, () => {
				this.updateVTF()
			})
		}

		this.handler = {
			get: <K extends keyof VTF["flags"]>(target: VTF["flags"], p: K): VTF["flags"][keyof VTF["flags"]] => {
				return target[p]
			},
			set: <K extends keyof VTF["flags"]>(target: VTF["flags"], p: K, value: VTF["flags"][K]): boolean => {
				target[p] = value
				const propertyChangedInfo = { flags: { [p]: value } }
				this.onPropertyChanged(propertyChangedInfo)
				this.setState(propertyChangedInfo)
				return target[p] == value
			}
		}
		this.flags = new Proxy(this.VTF.flags, this.handler)

		// TGA
		this.tgaPath = tgaPath

		// Scale
		this._scale = 1

		this.onShouldSendStateEventEmitter = new EventEmitter<VTFPropertyChangeEvent>()

		// Status Bar Item
		this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, Number(uri.scheme == "git"))
		this.statusBarItem.text = "" // We will receive the scale from the webview later
		this.statusBarItem.command = {
			title: "Select VTF Zoom Level",
			command: "vscode-vdf.selectVTFZoomLevel",
			arguments: [this]
		}
		this.statusBarItem.show()
		this.onVTFDidChangeEventEmitter.event((e) => {
			if (e.scale != undefined) {
				this.statusBarItem.text = `${this.scale < 1 ? "  " : ""}${(this.scale * 100).toFixed()}%`
			}
		})
	}

	/**
	 * Extract a VTF using vtf2tga.exe
	 * @param teamFortress2Folder Absolute path to "Team Fortress 2" folder containing bin/vtf2tga.exe
	 * @param vtfPath Absolute path to input VTF
	 * @param tgaPath Absolute path to output TGA
	 */
	private static async extractVTF(teamFortress2Folder: string, vtfPath: string, tgaPath: string): Promise<void> {
		const args = `"${join(teamFortress2Folder, "bin/vtf2tga.exe")}" ${[
			"-i",
			`"${vtfPath}"`,
			"-o",
			`"${tgaPath}"`,
		].join(" ")}`

		const std = await promisify(exec)(args)

		if (std.stderr) {
			window.showErrorMessage(std.stderr)
		}
	}

	/**
	 * Handle a message receieved from the Custom Editor Webview
	 * @param message webview message
	 */
	public onDidReceiveMessage(message: any): void {
		const state = message.state
		if ("scale" in state) {
			this._scale = state.scale
			this.onPropertyChanged({ scale: this._scale })
		}
		if ("flags" in state) {
			for (const id in state.flags) {
				// @ts-ignore
				this.VTF.flags[id] = state.flags[id]
			}
			this.onPropertyChanged({ flags: state.flags })
		}
	}

	public undo(): void {
		this.changes--
	}

	public redo(): void {
		this.changes++
	}

	/**
	 * Notify extension client of VTF Document property changes
	 * @param propertyChangedInfo
	 */
	private onPropertyChanged(propertyChangedInfo: VTFPropertyChangeEvent): void {
		this.onVTFDidChangeEventEmitter.fire(propertyChangedInfo)
	}

	/**
	 * Notify Custom Editor Webview of VTF Document property changes
	 * @param propertyChangedInfo State Change
	 */
	private setState(propertyChangedInfo: VTFPropertyChangeEvent): void {
		this.onShouldSendStateEventEmitter.fire(propertyChangedInfo)
	}

	/**
	 * Compile the state of the VTF Document to a JSON serializable object
	 * @returns
	 */
	public getBackup(): VTFBackup {
		return {
			flags: this.getFlags(),
			changes: this.changes
		}
	}

	/**
	 * Update VTF Document properties from the file system
	 */
	private async updateVTF(): Promise<void> {
		if (this.isDirty) {
			return
		}

		this.VTF = new VTF(Buffer.from(await workspace.fs.readFile(this.uri)))
		this.flags = new Proxy(this.VTF.flags, this.handler)

		const propertyChangedInfo = { flags: this.flags }
		this.onPropertyChanged(propertyChangedInfo)
		this.setState(propertyChangedInfo)
	}

	/**
	 * Compile the VTF flags to decimal number
	 */
	public getFlags(): number {
		return this.VTF.getFlags()
	}

	/**
	 * Write VTF Flags to Buffer and return the Buffer
	 */
	public save(): Buffer {
		this.changes = 0
		return this.VTF.save()
	}

	/**
	 * Get the saved Buffer without modifying the VTF save state
	 */
	public saveAs(): Buffer {
		return this.VTF.saveAs()
	}

	/**
	 * Revert VTF Document to its last saved state on disk
	 */
	public revert(): void {
		this.VTF.setFlags(this.VTF.savedFlags)

		const propertyChangedInfo = { flags: this.flags }
		this.onPropertyChanged(propertyChangedInfo)
		this.setState(propertyChangedInfo)
	}

	/**
	 * Dispose VTF Document
	 */
	public dispose(): void {
		this.watcher?.close()
		this.onVTFDidChangeEventEmitter.dispose()
		this.onShouldSendStateEventEmitter.dispose()
		if (existsSync(this.tgaPath)) {
			rmSync(this.tgaPath)
		}
		this.statusBarItem.hide()
		this.statusBarItem.dispose()
	}
}
