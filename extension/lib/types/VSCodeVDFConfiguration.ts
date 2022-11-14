export interface VSCodeVDFConfiguration {
	readonly autoCompletionKind: "incremental" | "all"
	readonly hudAnimations: {
		readonly extraTabs: number
		readonly layoutScope: "event" | "file"
		readonly referencesCodeLens: {
			readonly showOnAllEvents: boolean
		}
	}
	readonly referencesCodeLens: {
		readonly showOnAllElements: boolean
	}
	readonly teamFortress2Folder: string
	readonly updateDiagnosticsEvent: "type" | "save"
}
