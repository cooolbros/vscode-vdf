import { Observable, type Subscription } from "rxjs"
import type { FileSystemMountPoint } from "../FileSystemMountPoint"

export function combineLatestPersistent<T>(observableSelector: (fileSystem: FileSystemMountPoint) => Observable<T>) {
	const subscriptions = new Map<string, Subscription>()
	let map = new Map<string, T | undefined>()
	return (source$: Observable<{ name: string, fileSystem: FileSystemMountPoint }[]>) => {
		return new Observable<T[]>((subscriber) => {
			const subscription = source$.subscribe((entries) => {

				for (const [observable, subscription] of subscriptions.entries().filter(([name]) => !entries.some((entry) => entry.name == name))) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}

				map = new Map(entries.values().map((entry) => [entry.name, map.get(entry.name)]))

				if (entries.length == 0) {
					subscriber.next([])
				}
				else {
					for (const entry of entries.values().filter((entry) => !subscriptions.has(entry.name))) {
						subscriptions.set(
							entry.name,
							observableSelector(entry.fileSystem).subscribe((value) => {
								map.set(entry.name, value)
								if (map.values().every((value) => value != undefined)) {
									subscriber.next(map.values().toArray() as T[])
								}
							})
						)
					}
				}
			})

			return () => {
				for (const [observable, subscription] of subscriptions) {
					subscription.unsubscribe()
					subscriptions.delete(observable)
				}
				subscription.unsubscribe()
				map.clear()
			}
		})
	}
}
