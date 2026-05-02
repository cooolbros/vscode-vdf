export type WatchEvent = (
	| { type: "create", exists: true }
	| { type: "change" }
	| { type: "delete", exists: false }
)
