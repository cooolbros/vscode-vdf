import { RemoteResourceFileSystemProvider } from "client/RemoteResourceFileSystemProvider"
import { FolderFileSystem } from "client/VirtualFileSystem/FolderFileSystem"
import { VirtualFileSystem } from "client/VirtualFileSystem/VirtualFileSystem"
import { VSCodeFileSystem } from "client/VirtualFileSystem/VSCodeFileSystem"
import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import { combineLatestPersistent } from "common/operators/combineLatestPersistent"
import { usingAsync } from "common/operators/usingAsync"
import { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import { Uri } from "common/Uri"
import { BehaviorSubject, distinctUntilChanged, finalize, firstValueFrom, map, shareReplay, switchMap, type Observable } from "rxjs"
import { VDF } from "vdf"
import vscode from "vscode"
import { z } from "zod"

/**
 * @class
 */
async function VPKFileSystem(root: Uri): Promise<FileSystemMountPoint> {
	const authority = JSON.stringify(root)
	return await VSCodeFileSystem(
		root,
		vscode.FileType.File,
		false,
		(path) => new Uri({ scheme: "vpk", authority: authority, path: `/${path}`, query: "", fragment: "" })
	)
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
			fileSystem.fileSystem[Symbol.asyncDispose]()
		}
	})

	stack.defer(() => watcher.dispose())

	const observables = new Map<string, Observable<Uri | null>>()

	return {
		resolveFile: (path) => {
			let observable = observables.get(path)
			if (!observable) {
				observable = fileSystems$.pipe(
					map((fileSystems) => fileSystems.map(({ fileSystem }) => fileSystem.resolveFile(path))),
					combineLatestPersistent(),
					map((uris) => uris.find((uri) => uri != null) ?? null),
					distinctUntilChanged((a, b) => Uri.equals(a, b)),
					finalize(() => observables.delete(path)),
					shareReplay({ bufferSize: 1, refCount: true })
				)
				observables.set(path, observable)
			}
			return observable
		},
		readDirectory: async (path, options) => {
			const results = await Promise.allSettled(fileSystems$.value.map(({ fileSystem }) => fileSystem.readDirectory(path, options)))

			return results
				.values()
				.filter((result) => result.status == "fulfilled")
				.map((result) => result.value)
				.flatMap((value) => value)
				.reduce((a, b) => {
					if (!a.some(([n]) => n == b[0])) {
						a.push(b)
					}
					return a
				}, <[string, vscode.FileType][]>[])
		},
		[Symbol.asyncDispose]: async () => {
			await stack.disposeAsync()
		}
	}
}

export class FileSystemMountPointFactory extends RefCountAsyncDisposableFactory<{ type: "tf2" } | { type: "folder", uri: Uri }, FileSystemMountPoint> {

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
													SearchPaths: z.record(z.union([z.string(), z.array(z.string())]))
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

										const fileSystems = (
											await Promise.allSettled(
												uris
													.filter((uri, index) => uris.findIndex((u) => u.equals(uri)) == index)
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
										)
											.filter((result) => result.status == "fulfilled")
											.map((result) => result.value)

										return VirtualFileSystem(fileSystems)
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

										return await VSCodeFileSystem(
											root,
											vscode.FileType.Directory,
											false,
											(path) => root.joinPath(path)
										)
									}
									default:
										throw new Error(teamFortress2Folder.scheme)
								}
							})),
							shareReplay(1)
						)

						return {
							resolveFile: (path) => {
								return fileSystem$.pipe(
									switchMap((fileSystem) => fileSystem.resolveFile(path))
								)
							},
							readDirectory: async (path, options) => {
								return (await firstValueFrom(fileSystem$)).readDirectory(path, options)
							},
							[Symbol.asyncDispose]: async () => {
							}
						} satisfies FileSystemMountPoint
					}
				}
			}
		)
	}
}
