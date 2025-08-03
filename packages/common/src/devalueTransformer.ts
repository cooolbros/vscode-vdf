import * as devalue from "devalue"
import { isObservable } from "rxjs"
import { Uri } from "./Uri"

export interface Options {
	reducers: Record<string, (value: unknown) => any>
	revivers: Record<string, (value: any) => any>
}

const common = {
	reducers: {
		Symbol: (value: unknown) => typeof value == "symbol" ? Symbol.keyFor(value) : undefined,
		Uri: (value: unknown) => value instanceof Uri ? value.toJSON() : undefined,
	},
	revivers: {
		Symbol: (value: ReturnType<Symbol["toString"]>) => Symbol.for(value),
		Uri: (value: ReturnType<Uri["toJSON"]>) => Uri.schema.parse(value),
	}
}

export function devalueTransformer({ reducers, revivers }: Options) {

	const inputReducers = {
		...common.reducers,
		...reducers,
		Observable: (value: unknown) => {
			if (isObservable(value)) {
				throw new Error("Cannot stringify input Observable")
			}
		}
	}

	const inputRevivers = {
		...common.revivers,
		...revivers
	}

	const outputReducers = {
		...common.reducers,
		...reducers,
		Observable: (value: unknown) => {
			if (isObservable(value)) {
				throw new Error("Cannot stringify output Observable")
			}
		}
	}

	const outputRevivers = {
		...common.revivers,
		...revivers,
	}

	return {
		input: {
			serialize: (object: any) => devalue.stringify(object, inputReducers),
			deserialize: (object: any) => devalue.parse(object, inputRevivers)
		},
		output: {
			serialize: (object: any) => devalue.stringify(object, outputReducers),
			deserialize: (object: any) => devalue.parse(object, outputRevivers)
		}
	}
}
