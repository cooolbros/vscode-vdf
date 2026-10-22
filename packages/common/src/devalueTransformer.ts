// oxlint-disable typescript/no-explicit-any
import type { DataTransformer } from "@trpc/server"
import * as devalue from "devalue"

export interface Options {
	reducers: { [key: string]: (value: any) => any }
	revivers: { [key: string]: (value: any) => any }
}

export function devalueTransformer({ reducers, revivers }: Options): DataTransformer {
	return {
		serialize: (object: any) => devalue.stringify(object, reducers),
		deserialize: (object: any) => devalue.parse(object, revivers)
	}
}
