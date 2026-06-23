import { RemoteResourceFileSystemProvider } from "client/RemoteResourceFileSystemProvider"
import { FolderFileSystem } from "client/VirtualFileSystem/FolderFileSystem"
import { VirtualFileSystem } from "client/VirtualFileSystem/VirtualFileSystem"
import { VSCodeFileSystem } from "client/VirtualFileSystem/VSCodeFileSystem"
import type { FileSystemKey } from "common/FileSystemKey"
import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { usingAsync } from "common/operators/usingAsync"
import { findMap } from "common/popfile/findMap"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { posix } from "path"
import { BehaviorSubject, distinctUntilChanged, finalize, firstValueFrom, map, shareReplay, switchMap, type Observable } from "rxjs"
import { VDF } from "vdf"
import vscode from "vscode"
import { z } from "zod"

/**
 * @class
 */
async function VPKFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	const query = `?root=${JSON.stringify(root)}`
	return await VSCodeFileSystem({
		root: root,
		type: vscode.FileType.File,
		watch: false,
		resolvePath: (path) => new Uri({ scheme: "vpk", authority: "", path: `/${path}`, query: query, fragment: "" })
	})
}

/**
 * @class
 */
async function BSPFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	const query = `?root=${JSON.stringify(root)}`
	return await VSCodeFileSystem({
		root: root,
		type: vscode.FileType.File,
		watch: false,
		resolvePath: (path) => new Uri({ scheme: "bsp", authority: "", path: `/${path}`, query: query, fragment: "" })
	})
}

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
			return { name: name, fileSystem: await factory.get({ type: "folder", uri: dirname.joinPath(name) }) }
		}
		else if (name.endsWith(".vpk")) {
			return { name: name, fileSystem: await VPKFileSystem(dirname.joinPath(name)) }
		}
		else {
			return null
		}
	}

	const stack = new AsyncDisposableStack()

	const fileSystems$ = new BehaviorSubject<SortedArray<{ name: string, fileSystem: FileSystemMountPoint }>>(new SortedArray(
		(a, b) => a.name.localeCompare(b.name),
		...(await Promise.all(
			(await vscode.workspace.fs.readDirectory(dirname)).map(async ([name, type]) => create(name, type))
		)).filter((value) => value != null)
	))

	stack.defer(() => fileSystems$.complete())
	stack.defer(async () => {
		for (const fileSystem of fileSystems$.value) {
			await fileSystem.fileSystem[Symbol.asyncDispose]()
		}
	})

	const watcher = stack.adopt(
		vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.from(dirname), "*"), false, true, false),
		(disposable) => disposable.dispose()
	)

	stack.adopt(
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
		}),
		(disposable) => disposable.dispose()
	)

	stack.adopt(
		watcher.onDidDelete(async (event) => {
			const uri = new Uri(event)
			const basename = uri.basename()
			const fileSystem = fileSystems$.value.find(({ name }) => name == basename)

			if (fileSystem != undefined) {
				fileSystems$.value.splice(fileSystems$.value.indexOf(fileSystem), 1)
				fileSystems$.next(fileSystems$.value)
				fileSystem.fileSystem[Symbol.asyncDispose]()
			}
		}),
		(disposable) => disposable.dispose()
	)

	const observables = new Map<string, Observable<Entry>>()

	return {
		resolve: (path) => {
			let observable = observables.get(path)
			if (!observable) {
				observable = fileSystems$.pipe(
					map((fileSystems) => fileSystems.map(({ fileSystem }) => fileSystem.resolve(path))),
					combineLatestPersistent(),
					map((entries) => entries.find((entry) => entry.type != EntryType.None) ?? { type: <const>EntryType.None, uri: null } as Entry),
					distinctUntilChanged((a, b) => a.type == b.type && Uri.equals(a.uri, b.uri)),
					finalize(() => observables.delete(path)),
					shareReplay({ bufferSize: 1, refCount: true })
				)
				observables.set(path, observable)
			}
			return observable
		},
		readDirectory: async (path, options) => {
			const results = await Promise.allSettled(fileSystems$.value.map(({ fileSystem }) => fileSystem.readDirectory(path, options)))
			const map = new Map<string, vscode.FileType>()
			for (const result of results.values().filter((result) => result.status == "fulfilled")) {
				for (const [name, type] of result.value) {
					map.getOrInsert(name, type)
				}
			}
			return map.entries().toArray()
		},
		[Symbol.asyncDispose]: async () => {
			await stack.disposeAsync()
		}
	}
}

export class FileSystemMountPointFactory extends RefCountAsyncDisposableFactory<FileSystemKey, FileSystemMountPoint> {

	constructor(context: vscode.ExtensionContext, teamFortress2Folder$: Observable<Uri>) {
		super(
			(path) => JSON.stringify(path),
			async (path, factory) => {
				switch (path.type) {
					case "folder": {
						return await FolderFileSystem(path.uri)
					}
					case "tf2": {
						const fileSystem$ = teamFortress2Folder$.pipe(
							switchMap((teamFortress2Folder) => usingAsync<FileSystemMountPoint>(async () => {
								switch (teamFortress2Folder.scheme) {
									case "file": {
										const gameInfo = VDF.parse(new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(teamFortress2Folder.joinPath("tf/gameinfo.txt"))))

										const result = z.object({
											GameInfo: z.object({
												FileSystem: z.object({
													SearchPaths: z.record(z.string(), z.union([z.string(), z.array(z.string())]))
												})
											})
										}).safeParse(gameInfo)

										if (!result.success) {
											console.error(result.error)
											throw new Error("Invalid gameinfo.txt", { cause: result.error })
										}

										const { GameInfo: { FileSystem: { SearchPaths: searchPaths } } } = result.data

										const uris = Object
											.values(searchPaths)
											.flatMap((i) => Array.isArray(i) ? i : [i])
											.map((value) => {
												const relativePath = value
													.replace("|all_source_engine_paths|", "")
													.replace("|gameinfo_path|", "tf/")

												return teamFortress2Folder.joinPath(relativePath)
											})

										return VirtualFileSystem(uris
											.filter((uri, index) => uris.findIndex((u) => Uri.equals(u, uri)) == index)
											.map(async (uri) => {
												try {
													const basename = uri.basename()

													if (basename == "*") {
														return await WildcardFileSystem(uri, factory)
													}

													if (basename.endsWith(".vpk")) {
														const vpk = uri.dirname().joinPath(basename.replace(".vpk", "_dir.vpk"))
														return await VPKFileSystem(vpk)
													}

													return await factory.get({ type: "folder", uri: uri })
												}
												catch (error) {
													if (!(error instanceof vscode.FileSystemError) || error.code != "FileNotFound") {
														console.error(error)
													}

													throw error
												}
											})
										)
									}
									case RemoteResourceFileSystemProvider.scheme: {
										const root = new Uri({ scheme: RemoteResourceFileSystemProvider.scheme, path: "/" })

										try {
											await vscode.workspace.fs.stat(root)
										}
										catch (error) {
											console.warn(error)
											context.subscriptions.push(vscode.workspace.registerFileSystemProvider(RemoteResourceFileSystemProvider.scheme, new RemoteResourceFileSystemProvider(), { isCaseSensitive: true, isReadonly: true }))
										}

										return await VSCodeFileSystem({
											root: root,
											type: vscode.FileType.Directory,
											watch: false,
											resolvePath: (path) => root.joinPath(path)
										})
									}
									default:
										throw new Error(teamFortress2Folder.scheme)
								}
							})),
							shareReplay(1)
						)

						return {
							resolve: (path) => {
								return fileSystem$.pipe(
									switchMap((fileSystem) => fileSystem.resolve(path))
								)
							},
							readDirectory: async (path, options) => {
								return (await firstValueFrom(fileSystem$)).readDirectory(path, options)
							},
							[Symbol.asyncDispose]: async () => {
							}
						} satisfies FileSystemMountPoint
					}
					case "popfile:bsp": {
						const extname = posix.extname(path.uri.basename())
						if (extname != ".pop") {
							throw new Error(extname)
						}

						await using teamFortress2FileSystem = await factory.get({ type: "tf2" })
						const bsp = await findMap(path.uri, teamFortress2FileSystem)
						if (!bsp) {
							throw new Error()
						}

						const bspEntry = await firstValueFrom(teamFortress2FileSystem.resolve(`maps/${bsp}`))
						if (bspEntry.type != EntryType.File) {
							throw new Error()
						}

						return await factory.get({ type: "bsp", uri: bspEntry.uri })
					}
					case "bsp": {
						const extname = posix.extname(path.uri.basename())
						if (extname != ".bsp") {
							throw new Error(extname)
						}

						return await BSPFileSystem(path.uri)
					}
				}
			}
		)
	}
}
