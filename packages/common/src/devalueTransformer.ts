import type { DataTransformer } from "@trpc/server/unstable-core-do-not-import"
import * as devalue from "devalue"

export interface Options {
	reducers: Record<string, (value: unknown) => any>
	revivers: Record<string, (value: any) => any>
}

export function devalueTransformer({ reducers, revivers }: Options): DataTransformer {
	return {
		serialize: (object: any) => devalue.stringify(object, reducers),
		deserialize: (object: any) => devalue.parse(object, revivers)
	}
}
