import { BehaviorSubject, distinctUntilChanged, map, Observable, shareReplay, skip, Subscription } from "rxjs"
import vscode, { commands, type CustomDocument, StatusBarAlignment, type StatusBarItem, window, workspace } from "vscode"

const VTF_WIDTH_OFFSET = 16
const VTF_HEIGHT_OFFSET = 18
const VTF_FLAGS_OFFSET = 20

const KB = 1024
const MB = KB * KB
const GB = MB * KB

function size(bytes: number) {
	if (bytes < KB) {
		return `${bytes}B`
	}
	else if (bytes < MB) {
		return `${(bytes / KB).toFixed(2)}KB`
	}
	else if (bytes < GB) {
		return `${(bytes / MB).toFixed(2)}MB`
	}
	else {
		return `${(bytes / GB).toFixed(2)}GB`
	}
}

function unsubscribe(subscription: Subscription) {
	subscription.unsubscribe()
}

class DistinctBehaviorSubject<T> extends BehaviorSubject<T> {
	public next(value: T): void {
		if (value != this.value) {
			super.next(value)
		}
	}
}

export class VTFDocument implements CustomDocument {

	public static readonly flags = (buf: Uint8Array) => new DataView(buf.buffer).getUint32(VTF_FLAGS_OFFSET, true)

	public readonly uri: vscode.Uri
	public readonly readonly: boolean
	public readonly buf$: BehaviorSubject<Uint8Array>
	public readonly flags$: DistinctBehaviorSubject<number>
	public readonly scale$: DistinctBehaviorSubject<number>
	public changes = 0

	private readonly zoomLevelStatusBarItem: StatusBarItem
	private readonly dimensionsStatusBarItem: StatusBarItem
	private readonly binarySizeStatusBarItem: StatusBarItem

	public dispose: () => void

	public constructor(uri: vscode.Uri, readonly: boolean, buf: Uint8Array, watcher: Observable<Uint8Array> & { [Symbol.asyncDispose](): Promise<void> }, backup: number | null) {
		this.uri = uri
		this.readonly = readonly

		const stack = new AsyncDisposableStack()
		stack.use(watcher)

		this.buf$ = new BehaviorSubject(buf)
		stack.defer(() => this.buf$.complete())

		const dataView$ = this.buf$.pipe(
			map((buf) => new DataView(buf.buffer)),
			shareReplay({ bufferSize: 1, refCount: true })
		)

		this.flags$ = new DistinctBehaviorSubject(backup ?? new DataView(this.buf$.value.buffer).getUint16(VTF_WIDTH_OFFSET, true))
		stack.defer(() => this.flags$.complete())
		stack.adopt(
			dataView$.pipe(skip(1)).subscribe((dataView) => this.flags$.next(dataView.getUint32(VTF_FLAGS_OFFSET, true))),
			unsubscribe
		)

		stack.adopt(
			watcher.subscribe(async (buf) => {
				if (this.changes == 0) {
					this.buf$.next(buf)
				}
				else {
					const result = await window.showWarningMessage("This file has changed on disk, but you have unsaved changes. Saving now will overwrite the file on disk with your changes.", "Overwrite", "Revert")
					switch (result) {
						case "Overwrite":
							commands.executeCommand("workbench.action.files.save")
							break
						case "Revert":
							commands.executeCommand("workbench.action.files.revert")
							break
					}
				}
			}),
			unsubscribe
		)

		this.scale$ = new DistinctBehaviorSubject(100)
		stack.defer(() => this.scale$.complete())

		let priority = 100

		this.zoomLevelStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		stack.defer(() => this.zoomLevelStatusBarItem.dispose())

		stack.adopt(
			this.scale$.pipe(
				map((scale) => `${scale}%`),
				distinctUntilChanged(),
			).subscribe((text) => this.zoomLevelStatusBarItem.text = text),
			unsubscribe
		)

		this.zoomLevelStatusBarItem.command = {
			title: "Select VTF Zoom Level",
			command: "vscode-vdf.selectVTFZoomLevel",
			arguments: [this]
		}

		this.dimensionsStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		stack.defer(() => this.dimensionsStatusBarItem.dispose())
		stack.adopt(
			dataView$.pipe(
				map((dataView) => `${dataView.getUint16(VTF_WIDTH_OFFSET, true)}x${dataView.getUint16(VTF_HEIGHT_OFFSET, true)}`),
				distinctUntilChanged(),
			).subscribe((text) => this.dimensionsStatusBarItem.text = text),
			unsubscribe
		)

		this.binarySizeStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		stack.defer(() => this.binarySizeStatusBarItem.dispose())
		stack.adopt(
			dataView$.pipe(
				map((dataView) => dataView.byteLength),
				distinctUntilChanged(),
			).subscribe((bytes) => {
				this.binarySizeStatusBarItem.text = size(bytes)
				this.binarySizeStatusBarItem.tooltip = `${bytes}`
			}),
			unsubscribe
		)

		this.dispose = () => stack.disposeAsync()
	}

	public show() {
		this.zoomLevelStatusBarItem.show()
		this.dimensionsStatusBarItem.show()
		this.binarySizeStatusBarItem.show()
	}

	public hide() {
		this.zoomLevelStatusBarItem.hide()
		this.dimensionsStatusBarItem.hide()
		this.binarySizeStatusBarItem.hide()
	}

	public save() {
		this.changes = 0
		new DataView(this.buf$.value.buffer).setUint32(VTF_FLAGS_OFFSET, this.flags$.value, true)
		return this.buf$.value
	}

	public saveAs() {
		const buf = new Uint8Array(this.buf$.value.buffer)
		new DataView(buf.buffer).setUint32(VTF_FLAGS_OFFSET, this.flags$.value, true)
		return buf
	}

	public async revert() {
		this.changes = 0
		this.buf$.next(await workspace.fs.readFile(this.uri))
	}

	public backup() {
		const buf = new Uint8Array(4)
		new DataView(buf.buffer).setUint32(0, this.flags$.value, true)
		return buf
	}
}
