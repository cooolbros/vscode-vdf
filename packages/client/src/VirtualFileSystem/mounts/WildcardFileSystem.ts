import { Uri } from "common/Uri"
import { BehaviorSubject, distinctUntilChanged, map, Observable, Subscription } from "rxjs"
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
					(source) => {
						const uris = new SortedArray<{ name: string, value: Uri | null }>((a, b) => a.name.localeCompare(b.name))
						return new Observable<SortedArray<{ name: string, value: Uri | null }>>((subscriber) => {
							const subscriptions = new Map<string, Subscription>()
							const subscription = source.subscribe((fileSystems) => {

								let added = fileSystems.filter(({ name }) => subscriptions.has(name)).length

								for (const fileSystem of fileSystems) {
									if (!subscriptions.has(fileSystem.name)) {
										subscriptions.set(
											fileSystem.name,
											fileSystem.fileSystem.resolveFile(path).subscribe((uri) => {
												const existing = uris.find((value) => value.name == fileSystem.name)
												if (existing) {
													existing.value = uri
												}
												else {
													uris.push({ name: fileSystem.name, value: uri })
												}

												added = Math.max(added - 1, 0)
												if (added == 0) {
													subscriber.next(uris)
												}
											})
										)
									}
								}

								for (const [name, subscription] of subscriptions) {
									if (!fileSystems.some((value) => value.name == name)) {
										subscription.unsubscribe()
										subscriptions.delete(name)
									}
								}
							})

							return () => {
								for (const subscription of subscriptions.values()) {
									subscription.unsubscribe()
								}
								subscription.unsubscribe()
							}
						})
					},
					map((uris) => uris.map(({ value }) => value)),
					map((uris) => uris.find((uri) => uri != null) ?? null),
					distinctUntilChanged(Uri.equals)
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
