import { EntryType, type Entry, type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { Uri } from "common/Uri"
import { combineLatest, defer, distinctUntilChanged, finalize, map, Observable, of, shareReplay } from "rxjs"
import vscode from "vscode"

/**
 * @class
 */
export async function VirtualFileSystem(promises: Promise<FileSystemMountPoint>[]): Promise<FileSystemMountPoint> {

	const fileSystems = (await Promise.allSettled(promises))
		.values()
		.filter((result) => result.status == "fulfilled")
		.map((result) => result.value)
		.toArray()

	const observables = new Map<string, Observable<Entry>>()

	return {
		resolve: (path) => {
			let observable$ = observables.get(path)
			if (!observable$) {
				observable$ = defer(() => {
					return fileSystems.length != 0
						? combineLatest(fileSystems.map((fileSystem) => fileSystem.resolve(path)))
						: of([])
				}).pipe(
					map((entries) => entries.find((entry) => entry.type != EntryType.None) ?? { type: <const>EntryType.None, uri: null } as Entry),
					distinctUntilChanged((a, b) => a.type == b.type && Uri.equals(a.uri, b.uri)),
					finalize(() => observables.delete(path)),
					shareReplay({ bufferSize: 1, refCount: true })
				)
				observables.set(path, observable$)
			}
			return observable$
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
		[Symbol.asyncDispose]: async () => {
			await Promise.all(fileSystems.map((fileSystem) => fileSystem[Symbol.asyncDispose]()))
		}
	}
}
