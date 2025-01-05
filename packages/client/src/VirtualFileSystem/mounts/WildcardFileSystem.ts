import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { Uri } from "common/Uri"
import { BehaviorSubject, distinctUntilChanged, map, Observable, shareReplay } from "rxjs"
import * as vscode from "vscode"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import type { FileSystemMountPointFactory } from "../FileSystemMountPointFactory"

class SortedArray<T> extends Array<T> {

	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/species
	public static get [Symbol.species]() {
		return Array
	}

	constructor(private readonly compareFn: (a: T, b: T) => number, ...items: T[]) {
		super(...items.sort(compareFn))
	}

	private update() {
		this.sort(this.compareFn)
	}

	public push(...items: T[]): number {
		const length = super.push(...items)
		this.update()
		return length
	}

	public splice(start: number, deleteCount: number, ...items: T[]): T[] {
		const deleted = super.splice(start, deleteCount, ...items)
		this.update()
		return deleted
	}
}

/**
 * @class
 */
export async function WildcardFileSystem(uri: Uri, factory: FileSystemMountPointFactory): Promise<FileSystemMountPoint> {

	if (uri.basename() != "*") {
		throw new Error(`${uri} is not a *.`)
	}

	const dirname = uri.dirname()

	async function create(name: string, type: vscode.FileType) {
		if (type == vscode.FileType.Directory) {
			return { name: name, fileSystem: await factory.folder(dirname.joinPath(name)) }
		}
		else if (name.endsWith(".vpk")) {
			return { name: name, fileSystem: await factory.vpk(dirname.joinPath(name)) }
		}
		else {
			return null
		}
	}

	const fileSystems$ = new BehaviorSubject<SortedArray<{ name: string, fileSystem: FileSystemMountPoint }>>(new SortedArray(
		(a, b) => a.name.localeCompare(b.name),
		...(await Promise.all(
			(await vscode.workspace.fs.readDirectory(dirname)).map(async ([name, type]) => create(name, type))
		)).filter((value) => value != null)
	))

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(dirname), "*"), false, true, false)

	watcher.onDidCreate(async (event) => {
		const uri = new Uri(event)
		const basename = uri.basename()
		const type = (await vscode.workspace.fs.stat(uri)).type

		if (!fileSystems$.value.some(({ name }) => name == basename)) {
			const fileSystem = await create(basename, type)
			if (fileSystem) {
				fileSystems$.value.push(fileSystem)
				fileSystems$.next(fileSystems$.value)
			}
		}
	})

	watcher.onDidDelete(async (event) => {
		const uri = new Uri(event)
		const basename = uri.basename()
		const fileSystem = fileSystems$.value.find(({ name }) => name == basename)

		if (fileSystem != undefined) {
			fileSystems$.value.splice(fileSystems$.value.indexOf(fileSystem), 1)
			fileSystems$.next(fileSystems$.value)
			fileSystem.fileSystem.dispose()
		}
	})

	const observables = new Map<string, Observable<Uri | null>>()

	return {
		resolveFile: (path) => {
			let observable = observables.get(path)
			if (!observable) {
				observable = fileSystems$.pipe(
					map((fileSystems) => fileSystems.map(({ fileSystem }) => fileSystem.resolveFile(path))),
					combineLatestPersistent(),
					map((uris) => uris.find((uri) => uri != null) ?? null),
					distinctUntilChanged(Uri.equals),
					shareReplay(1)
				)
				observables.set(path, observable)
			}
			return observable
		},
		readDirectory: async (path, options) => {
			const all = (await Promise.all(fileSystems$.value.map(({ fileSystem }) => fileSystem.readDirectory(path, options)))).flat()
			return all.filter(([name], index) => all.findIndex(([n]) => n == name) == index)
		},
		dispose: () => {
			watcher.dispose()
			for (const { fileSystem } of fileSystems$.value) {
				fileSystem?.dispose()
			}
			fileSystems$.complete()
		}
	}
}
