import { posix } from "path"
import { concat, map, NEVER, Observable, of, Subscription, switchMap } from "rxjs"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"
import { Uri } from "../Uri"
import type { WatchEvent } from "../WatchEvent"
import { usingAsync } from "./usingAsync"

export interface BaseConfig<D extends DocumentLike, T> {
	current: Uri
	documentSelector: (uri: Uri) => Promise<D>
	observableSelector: (document: D) => Observable<T>
}

export interface DocumentLike extends AsyncDisposable {
	readonly uri: Uri
	readonly base$: Observable<string[]>
}

export interface AmbientConfig<D extends DocumentLike, T> extends BaseConfig<D, T> {
	watch: (uri: Uri) => Observable<WatchEvent>,
}

export interface FSConfig<D extends DocumentLike, T> extends AmbientConfig<D, T> {
	fileSystem: FileSystemMountPoint
	relativeFolderPath: string
}

export interface CombineLatestBaseFilesConfig<R> {
	stack: Stack
	open: (base: BaseValue) => Observable<BaseResult<R>>
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
	Cyclic,
	Base,
}

export type BaseError = (
	| { type: BaseErrorType.Cyclic, stack: Stack }
	| { type: BaseErrorType.Self, self: string, detail: string, uri: Uri }
	| { type: BaseErrorType.Base, path: string, errors: BaseError[] }
)

export const fs = <D extends DocumentLike, T>(config: FSConfig<D, T>) => {
	const { current, documentSelector, observableSelector, watch, fileSystem, relativeFolderPath } = config

	const self = `${relativeFolderPath}/${current.basename()}`
	const external = ambient({ current, documentSelector, observableSelector, watch })

	return ({ stack, detail }: BaseValue): Observable<BaseResult<T>> => {
		const path = posix.resolve(`/${relativeFolderPath}/${detail}`).substring(1)

		if (path.toLowerCase() == self.toLowerCase()) {
			return concat(
				of<BaseResult<T>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
				NEVER
			)
		}

		const index = stack.findIndex((p) => p.path.toLowerCase() == path.toLowerCase())
		if (index != -1 || stack.length > 32) {
			return concat(
				of<BaseResult<T>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
				NEVER
			)
		}

		return fileSystem.resolveFile(path).pipe(
			switchMap((uri) => {
				if (uri != null) {
					return usingAsync(async () => await documentSelector(uri)).pipe(
						switchMap((document) => {
							return document.base$.pipe(
								map((base) => ({ base: base, value: undefined })),
								combineLatestBaseFiles({
									stack: [...stack, { path: path, uri: current }],
									open: fs({
										current: document.uri,
										documentSelector,
										observableSelector,
										watch,
										fileSystem,
										relativeFolderPath
									})
								}),
								switchMap(({ base: results }) => {
									if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
										return observableSelector(document).pipe(
											map((value) => ({ type: <const>BaseResultType.Success, ambient: false, value: value })),
										)
									}

									return of<BaseResult<T>>({
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
									})
								})
							)
						})
					)
				}
				else {
					return external({ stack, detail })
				}
			})
		)
	}
}

export const ambient = <D extends DocumentLike, T>(config: AmbientConfig<D, T>) => {
	const { current, documentSelector, observableSelector, watch } = config

	const self = current.fsPath
	const dirname = current.dirname()

	return ({ stack, detail }: BaseValue): Observable<BaseResult<T>> => {
		const uri = current.with({ path: posix.resolve(dirname.joinPath(detail).path) })
		const fsPath = uri.fsPath.toLowerCase()

		if (Uri.equals(current, uri) || current.fsPath.toLowerCase() == fsPath) {
			return concat(
				of<BaseResult<T>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Self, self: self, detail: detail, uri: current }] }),
				NEVER
			)
		}

		const index = stack.findIndex((p) => p.path.toLowerCase() == fsPath)
		if (index != -1) {
			return concat(
				of<BaseResult<T>>({ type: <const>BaseResultType.Error, self: self, errors: [{ type: <const>BaseErrorType.Cyclic, stack: stack.slice(index) }] }),
				NEVER
			)
		}

		return watch(uri).pipe(
			switchMap((exists) => {
				if (!exists) {
					return concat(of({ type: <const>BaseResultType.None }), NEVER)
				}

				return usingAsync(async () => await documentSelector(uri)).pipe(
					switchMap((document) => {
						return document.base$.pipe(
							map((base) => ({ base: base, value: undefined })),
							combineLatestBaseFiles({
								stack: [...stack, { path: self, uri: current }],
								open: ambient({
									current: document.uri,
									documentSelector,
									observableSelector,
									watch,
								}),
							}),
							switchMap(({ base: results }) => {
								if (results.every((result) => result.type == BaseResultType.None || result.type == BaseResultType.Success)) {
									return observableSelector(document).pipe(
										map((value) => ({ type: <const>BaseResultType.Success, ambient: true, value: value }))
									)
								}

								return of<BaseResult<T>>({
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
								})
							}),
						)
					})
				)
			})
		)
	}
}

export function combineLatestBaseFiles<T, R>(config: CombineLatestBaseFilesConfig<R>) {
	return (source$: Observable<{ base: string[], value: T }>) => {
		const { stack, open } = config
		const subscriptions = new Map<string, Subscription>()

		interface Current {
			value: T | undefined
			base: {
				details: string[]
				map: Map<string, { result: BaseResult<R> } | undefined>
			}
		}

		const current: Current = {
			value: undefined,
			base: { details: [], map: new Map() }
		}

		return new Observable<{ base: BaseResult<R>[], value: T }>((subscriber) => {

			function next() {
				if (current.base.map.values().every((value) => value?.result != undefined)) {
					subscriber.next({
						base: current.base.details.map((value) => current.base.map.get(value)!.result),
						value: current.value!,
					})
				}
			}

			const subscription = source$.subscribe(({ base, value }) => {
				current.value = value

				if (base.length == 0) {
					for (const subscription of subscriptions.values()) {
						subscription.unsubscribe()
					}
					subscriptions.clear()
					subscriber.next({
						base: [],
						value: current.value!
					})
				}
				else {
					current.base = {
						details: base,
						map: new Map(base.values().map((detail) => [detail, current.base.map.get(detail)]))
					}

					for (const [detail, subscription] of subscriptions.entries().filter(([detail]) => !base.includes(detail))) {
						subscription.unsubscribe()
						subscriptions.delete(detail)
					}

					for (const detail of base) {
						if (!subscriptions.has(detail)) {
							subscriptions.set(detail, open({ stack, detail }).subscribe((result) => {
								current.base.map.set(detail, { result })
								next()
							}))
						}
					}

					next()
				}
			})

			return () => {
				for (const subscription of subscriptions.values()) {
					subscription.unsubscribe()
				}
				subscription.unsubscribe()
				subscriptions.clear()
				current.base?.map.clear()
			}
		})
	}
}
