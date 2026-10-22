import { posix } from "path"
import { concat, filter, map, NEVER, Observable, of, switchMap } from "rxjs"
import { EntryType, type FileSystemMountPoint } from "../FileSystemMountPoint"
import { Uri } from "../Uri"
import type { WatchEvent } from "../WatchEvent"
import { combineLatestPersistent } from "./combineLatestPersistent"

export interface BaseConfig<D extends DocumentLike> {
	current: Uri
	documentSelector(this: void, uri: Uri, detail: string, ambient: boolean): Observable<BaseResult<D>>
}

export interface DocumentLike {
	readonly uri: Uri
	readonly base$: Observable<string[]>
}

export interface AmbientConfig<D extends DocumentLike> extends BaseConfig<D> {
	watch(this: void, uri: Uri): Observable<WatchEvent>,
	preserve: boolean
}

export interface FSConfig<D extends DocumentLike> extends AmbientConfig<D> {
	fileSystem: FileSystemMountPoint
	relativeFolderPath: string | null
}

export interface CombineLatestBaseFilesConfig<R> {
	stack: Stack
	open(this: void, base: BaseValue): Observable<BaseResult<R>>
}

export type Stack = { path: string, uri: Uri }[]

export interface BaseValue {
	stack: Stack
	detail: string
}

export const enum BaseResultType {
	None,
	Success,
	Error,
}

export type BaseResult<T> = (
	| { type: BaseResultType.None }
	| { type: BaseResultType.Success, ambient: boolean, value: T }
	| { type: BaseResultType.Error, self: string, errors: BaseError[] }
)

export const enum BaseErrorType {
	Self,
	Directory,
	Language,
	Cyclic,
	Base,
}

export type BaseError = (
	| { type: BaseErrorType.Self, self: string, detail: string, uri: Uri }
	| { type: BaseErrorType.Directory, self: string, detail: string, uri: Uri }
	| { type: BaseErrorType.Language, detail: string, language: { id: string, name: string } }
	| { type: BaseErrorType.Cyclic, stack: Stack }
	| { type: BaseErrorType.Base, path: string, errors: BaseError[] }
)

export const fs = <D extends DocumentLike>(config: FSConfig<D>) => {
	const { current, documentSelector, watch, preserve, fileSystem, relativeFolderPath } = config

	const self = `${relativeFolderPath != null ? `${relativeFolderPath}/` : ""}${current.basename()}`
	const external = ambient({ current, documentSelector, watch, preserve })

	return ({ stack, detail }: BaseValue): Observable<BaseResult<D>> => {
		const path = posix.resolve(`/${relativeFolderPath != null ? `${relativeFolderPath}/` : ""}${detail}`).substring(1)

		if (path.toLowerCase() == self.toLowerCase()) {
			return concat(
				of<BaseResult<D>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
				NEVER
			)
		}

		const index = stack.findIndex((p) => p.path.toLowerCase() == path.toLowerCase())
		if (index != -1 || stack.length > 32) {
			return concat(
				of<BaseResult<D>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
				NEVER
			)
		}

		return fileSystem.resolve(path).pipe(
			switchMap((entry) => {
				switch (entry.type) {
					case EntryType.None:
						return external({ stack, detail })
					case EntryType.File:
						return documentSelector(entry.uri, detail, false).pipe(
							switchMap((result) => {
								if (result.type != BaseResultType.Success) {
									return of(result)
								}

								const document = result.value
								return document.base$.pipe(
									map((base) => ({ base: base })),
									combineLatestBaseFiles({
										stack: [...stack, { path: self, uri: current }],
										open: fs({
											current: document.uri,
											documentSelector,
											watch,
											preserve: true,
											fileSystem,
											relativeFolderPath: (() => {
												const dirname = posix.dirname(path)
												return dirname != "." ? dirname : null
											})(),
										})
									}),
									map(({ base: results }) => {
										if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
											return {
												type: <const>BaseResultType.Success,
												ambient: false,
												value: document
											}
										}

										return {
											type: <const>BaseResultType.Error,
											self: self,
											errors: results
												.values()
												.map((result) => {
													switch (result.type) {
														case BaseResultType.None:
														case BaseResultType.Success:
															return null
														case BaseResultType.Error:
															return {
																type: <const>BaseErrorType.Base,
																path: result.self,
																errors: result.errors
															}
													}
												})
												.filter((error) => error != null)
												.toArray()
										}
									})
								)
							})
						)
					case EntryType.Directory:
						return concat(
							of<BaseResult<D>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Directory, self: self, detail: detail, uri: current }] }),
							NEVER
						)
				}
			})
		)
	}
}

export const ambient = <D extends DocumentLike>(config: AmbientConfig<D>) => {
	const { current, documentSelector, watch, preserve } = config

	const self = current.fsPath
	const dirname = current.dirname()

	return ({ stack, detail }: BaseValue): Observable<BaseResult<D>> => {
		const uri = current.with({ path: posix.resolve(dirname.joinPath(detail).path) })
		const fsPath = uri.fsPath.toLowerCase()

		if (Uri.equals(current, uri) || current.fsPath.toLowerCase() == fsPath) {
			return concat(
				of<BaseResult<D>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
				NEVER
			)
		}

		const index = stack.findIndex((p) => p.path.toLowerCase() == fsPath)
		if (index != -1) {
			return concat(
				of<BaseResult<D>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
				NEVER
			)
		}

		return watch(uri).pipe(
			filter((event) => event.type != "change"),
			switchMap((event) => {
				switch (event.type) {
					case "create":
						switch (event.entry.type) {
							case EntryType.File:
								return documentSelector(event.entry.uri, detail, true).pipe(
									switchMap((result) => {
										if (result.type != BaseResultType.Success) {
											return of(result)
										}

										const document = result.value
										return document.base$.pipe(
											map((base) => ({ base: base, value: undefined })),
											combineLatestBaseFiles({
												stack: [...stack, { path: self, uri: current }],
												open: ambient({
													current: document.uri,
													documentSelector,
													watch,
													preserve,
												}),
											}),
											map(({ base: results }) => {
												if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
													return {
														type: <const>BaseResultType.Success,
														ambient: preserve,
														value: document,
													}
												}

												return {
													type: <const>BaseResultType.Error,
													self: self,
													errors: results
														.values()
														.map((result) => {
															switch (result.type) {
																case BaseResultType.None:
																case BaseResultType.Success:
																	return null
																case BaseResultType.Error:
																	return {
																		type: <const>BaseErrorType.Base,
																		path: result.self,
																		errors: result.errors
																	}
															}
														})
														.filter((error) => error != null)
														.toArray()
												}
											}),
										)
									})
								)
							case EntryType.Directory:
								return concat(
									of<BaseResult<D>>({
										type: <const>BaseResultType.Error,
										self: self,
										errors: [{ type: <const>BaseErrorType.Directory, self: self, detail: detail, uri: current }]
									}),
									NEVER
								)
						}
					case "delete":
						return concat(of({ type: <const>BaseResultType.None }), NEVER)
				}
			})
		)
	}
}

export function combineLatestBaseFiles<T extends { base: string[] }, R>(config: CombineLatestBaseFilesConfig<R>) {
	const { stack, open } = config
	return combineLatestPersistent<T, { key: string }, BaseResult<R>, { value: T, base: BaseResult<R>[] }>({
		entries: (value) => value.base.map((base) => ({ key: base })),
		observableSelector: (entry) => open({ stack: stack, detail: entry.key }),
		resultSelector: (value, results) => ({ value: value, base: results })
	})
}
