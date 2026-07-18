import { type FileSystemMountPoint } from "common/FileSystemMountPoint"
import { fromTRPCSubscription } from "common/operators/fromTRPCSubscription"
import { shareReplayUntilDisposed } from "common/operators/shareReplayUntilDisposed"
import type { Uri } from "common/Uri"
import { concat, ignoreElements, map, take, type Observable } from "rxjs"
import type { GlobalDefinitionReferences, References } from "../../DefinitionReferences"
import { WorkspaceBase } from "../../WorkspaceBase"
import type { VMTLanguageServer } from "./VMTLanguageServer"

export class VMTWorkspace extends WorkspaceBase {

	private readonly surfaceProperties$: Observable<GlobalDefinitionReferences>

	public readonly globals$: Observable<GlobalDefinitionReferences[]>

	constructor({
		uri,
		fileSystem,
		server,
	}: {
		uri: Uri,
		fileSystem: FileSystemMountPoint,
		server: VMTLanguageServer,
	}) {
		super(uri, fileSystem)

		const ready$ = fromTRPCSubscription(server.trpc.servers.vgui.workspace.open, { uri }).pipe(
			shareReplayUntilDisposed(this.dispose$),
			take(1),
			ignoreElements()
		)

		this.surfaceProperties$ = concat(
			ready$,
			fromTRPCSubscription(server.trpc.servers.vgui.workspace.surfaceProperties, { key: uri }).pipe(
				map((definitions) => {
					return {
						definitions: definitions,
						references: {
							setDocumentReferences: (references, notify) => {
								const map = new Map<string, Map<string, References | null>>()
								map.set("scripts/surfaceproperties_manifest.txt", references)

								server.trpc.servers.vgui.workspace.setFilesReferences.mutate({
									key: uri,
									references: map
								})
							},
						}
					} satisfies GlobalDefinitionReferences
				})
			)
		)

		this.globals$ = this.surfaceProperties$.pipe(
			map((value) => [value]),
			shareReplayUntilDisposed(this.dispose$),
		)
	}
}
