import { BehaviorSubject } from "rxjs"
import { type CustomDocument, StatusBarAlignment, type StatusBarItem, type Uri, window } from "vscode"

const VTF_WIDTH_OFFSET = 16
const VTF_HEIGHT_OFFSET = 18

export const VTF_FLAGS_OFFSET = 20

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

class DistinctBehaviorSubject<T> extends BehaviorSubject<T> {
	public next(value: T): void {
		if (value != this.value) {
			super.next(value)
		}
	}
}

export class VTFDocument implements CustomDocument {

	public readonly uri: Uri
	public readonly buf: Uint8Array
	public readonly flags$: DistinctBehaviorSubject<number>
	public readonly scale$: DistinctBehaviorSubject<number>

	private readonly zoomLevelStatusBarItem: StatusBarItem
	private readonly dimensionsStatusBarItem: StatusBarItem
	private readonly binarySizeStatusBarItem: StatusBarItem

	public constructor(uri: Uri, buf: Uint8Array, backup: number | null) {
		this.uri = uri
		this.buf = buf

		const dataView = new DataView(this.buf.buffer)

		this.flags$ = new DistinctBehaviorSubject(backup ?? dataView.getUint32(VTF_FLAGS_OFFSET, true))
		this.scale$ = new BehaviorSubject(100)

		let priority = 100

		this.zoomLevelStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		this.scale$.subscribe((scale) => this.zoomLevelStatusBarItem.text = `${scale}%`)
		this.zoomLevelStatusBarItem.command = {
			title: "Select VTF Zoom Level",
			command: "vscode-vdf.selectVTFZoomLevel",
			arguments: [this]
		}

		this.dimensionsStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		this.dimensionsStatusBarItem.text = `${dataView.getUint16(VTF_WIDTH_OFFSET, true)}x${dataView.getUint16(VTF_HEIGHT_OFFSET, true)}`

		this.binarySizeStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, priority--)
		this.binarySizeStatusBarItem.text = size(buf.length)
		this.binarySizeStatusBarItem.tooltip = `${buf.length}`
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
		new DataView(this.buf.buffer).setUint32(VTF_FLAGS_OFFSET, this.flags$.value, true)
		return this.buf
	}

	public saveAs() {
		const buf = new Uint8Array(this.buf)
		new DataView(buf.buffer).setUint32(VTF_FLAGS_OFFSET, this.flags$.value, true)
		return buf
	}

	public revert() {
		this.flags$.next(new DataView(this.buf.buffer).getUint32(VTF_FLAGS_OFFSET, true))
	}

	public backup() {
		const buf = new Uint8Array(4)
		new DataView(buf.buffer).setUint32(0, this.flags$.value, true)
		return buf
	}

	public dispose() {
		this.flags$.complete()
		this.scale$.complete()
		this.zoomLevelStatusBarItem.dispose()
		this.dimensionsStatusBarItem.dispose()
		this.binarySizeStatusBarItem.dispose()
	}
}
