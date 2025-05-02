import type { FileSystemMountPoint } from "common/FileSystemMountPoint"
import type { RefCountAsyncDisposableFactory } from "common/RefCountAsyncDisposableFactory"
import type { Uri } from "common/Uri"
import { usingAsync } from "common/operators/usingAsync"
import { combineLatest, map, of, shareReplay, switchMap, type Observable } from "rxjs"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VMTTextDocument } from "./VMTTextDocument"

export class VMTWorkspace extends WorkspaceBase {

	public readonly surfaceProperties$: Observable<string[] | null>

	constructor(uri: Uri, fileSystem: FileSystemMountPoint, documents: RefCountAsyncDisposableFactory<Uri, VMTTextDocument>) {
		super(uri)
		this.surfaceProperties$ = fileSystem.resolveFile("scripts/surfaceproperties_manifest.txt").pipe(
			switchMap((uri) => {
				if (!uri) {
					return of(null)
				}

				return usingAsync(async () => await documents.get(uri)).pipe(
					switchMap((document) => document.documentSymbols$),
					map((documentSymbols) => {
						const surfaceproperties_manifest = documentSymbols.find((documentSymbol) => documentSymbol.children != undefined)?.children ?? []

						return surfaceproperties_manifest
							.filter((documentSymbol) => documentSymbol.key.toLowerCase() == "file" && documentSymbol.detail != undefined)
							.map((documentSymbol) => documentSymbol.detail!)
					}),
					switchMap((files) => {
						if (!files.length) {
							console.warn(`surfaceproperties_manifest.length == 0`)
							return of(null)
						}

						return combineLatest(
							files.map((file) => {
								return fileSystem.resolveFile(file).pipe(
									switchMap((uri) => {
										if (!uri) {
											return of([])
										}

										return usingAsync(async () => documents.get(uri)).pipe(
											switchMap((document) => {
												return document.documentSymbols$.pipe(
													map((documentSymbols) => {
														return documentSymbols.map((documentSymbol) => documentSymbol.key)
													})
												)
											}),
										)
									})
								)
							})
						).pipe(
							map((properties) => [...new Set(properties.flat())].toSorted()),
						)
					}),
				)
			}),
			shareReplay({ bufferSize: 1, refCount: true })
		)
	}
}
