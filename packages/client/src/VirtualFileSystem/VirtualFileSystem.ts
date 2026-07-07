import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { combineLatest, defer, distinctUntilChanged, finalize, map, Observable, of, shareReplay } from "rxjs"
import vscode from "vscode"

/**
 * @class
 */
export async function VirtualFileSystem(promises: Promise<FileSystemMountPoint>[]): Promise<FileSystemMountPoint> {

	const results = await Promise.allSettled(promises)
	const fileSystems: FileSystemMountPoint[] = []

	for (const result of results) {
		switch (result.status) {
			case "fulfilled":
				fileSystems.push(result.value)
				break
			case "rejected":
				// Some errors such as missing .vpk stat errors are already logged by the VSCode extension host,
				// so use console.log to differentiate from previous log and signal that these errors are non-fatal
				console.log(result.reason)
				break
		}
	}

	const observables = new Map<string, Observable<Entry>>()

	return {
		resolve: (path) => {
			return observables.getOrInsertComputed(path, () => {
				return defer(() => {
					return fileSystems.length != 0
						? combineLatest(fileSystems.map((fileSystem) => fileSystem.resolve(path)))
						: of([])
				}).pipe(
					map((entries) => entries.find((entry) => entry.type != EntryType.None) ?? { type: <const>EntryType.None, uri: null } as Entry),
					distinctUntilChanged((a, b) => a.type == b.type && Uri.equals(a.uri, b.uri)),
					finalize(() => observables.delete(path)),
					shareReplay({ bufferSize: 1, refCount: true })
				)
			})
		},
		readDirectory: async (path, options) => {
			const results = await Promise.allSettled(fileSystems.map((fileSystem) => fileSystem.readDirectory(path, options)))
			const map = new Map<string, vscode.FileType>()
			for (const result of results.values().filter((result) => result.status == "fulfilled")) {
				for (const [name, type] of result.value) {
					map.getOrInsert(name, type)
				}
			}
			return map.entries().toArray()
		},
		watchDirectory: (path, options) => {
			return defer(() => {
				return fileSystems.length != 0
					? combineLatest(fileSystems.map((fileSystem) => fileSystem.watchDirectory(path, options)))
					: of([])
			}).pipe(
				map((results) => {
					const map = new Map<string, vscode.FileType>()
					for (const result of results) {
						for (const [name, type] of result) {
							map.getOrInsert(name, type)
						}
					}
					return map.entries().toArray()
				})
			)
		},
		[Symbol.asyncDispose]: async () => {
			await Promise.all(fileSystems.map((fileSystem) => fileSystem[Symbol.asyncDispose]()))
		}
	}
}
