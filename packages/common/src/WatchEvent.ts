import type { Entry, EntryType } from "./FileSystemMountPoint"

export type WatchEvent = (
	| { type: "create", entry: SomeEntry }
	| { type: "change", entry: SomeEntry }
	| { type: "delete", entry: NoneEntry }
)

export type SomeEntry = Exclude<Entry, { type: EntryType.None }>

export type NoneEntry = Extract<Entry, { type: EntryType.None }>
